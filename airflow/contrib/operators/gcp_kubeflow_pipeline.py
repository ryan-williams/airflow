# -*- coding: utf-8 -*-
#
# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
#

import datetime
import os
from os import environ
from os.path import basename
from tempfile import NamedTemporaryFile
from time import sleep
from urllib.parse import urlparse

from airflow.models import BaseOperator, Variable
from airflow.plugins_manager import AirflowPlugin

import kfp
from kfp.compiler import Compiler
from kfp_server_api.rest import ApiException


class KubeflowPipelineOperator(BaseOperator):
    """
    Submit a Kubeflow Pipeline to an existing Kubeflow cluster.

    :param pipeline: path to a .tar.gz-packaged Kubeflow Pipeline (local or gs://), or
            @dsl.pipeline-annotated pipeline function
    :type pipeline: str | function
    :param host: hostname of the Kubeflow cluster to submit the pipeline to
    :type host: str
    :param client_id: client ID used by Identity-Aware Proxy.
    :type client_id: str
    :param experiment_name: the name of the Kubeflow Pipelines "experiment"
    :type experiment_name: str
    :param job_name: the name of the pipeline job (run)
    :type job_name: str
    :param params_fn: convert the DAG's `params` and DAG-run config into the actual params passed to the
            Kubeflow Pipeline. Provides a hook for converting DAG-run configs into KFP params, for easy
            `trigger_dag` CLI usage.
    :type params_fn: function
    """

    # Each "key" field is assigned a variable name to be searched for among DAG-run configs, global Airflow
    # Variables, and env vars, in case a value is not explicitly provided at operator-construction time.
    VARIABLE_KEYS = {
        'host': 'KUBEFLOW_HOST',
        'client_id': 'KUBEFLOW_OAUTH_CLIENT_ID',
        'experiment_name': 'KUBEFLOW_EXPERIMENT'
    }

    def __init__(self,
                 pipeline,
                 host=None,
                 client_id=None,
                 experiment_name=None,
                 job_name=None,
                 params_fn=None,
                 *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pipeline = pipeline
        self.host = host
        self.client_id = client_id
        self.experiment_name = experiment_name
        self.job_name = job_name
        self.params_fn = params_fn or (lambda params, conf: params)

    def execute(self, context):

        conf = 'dag_run' in context and \
               context['dag_run'].conf \
               or None

        def get(attr, throw=True):
            """Fetch a field, falling back to dag_run.conf, Airflow Variables, and finally env vars."""
            value = getattr(self, attr)
            if value is not None:
                return value

            key = self.VARIABLE_KEYS[attr]

            if conf and key in conf and conf[key]:
                return conf[key]

            class Sentinel:
                pass
            value = Variable.get(key, Sentinel)
            if value is not Sentinel:
                return value

            value = environ.get(key)
            if value is not None:
                return value

            if throw:
                raise ValueError("Couldn't resolve field %s or dag conf, variable, or env var %s" % (attr, key))

            return None

        host = get('host', context)
        client_id = get('client_id', context)

        self.log.info("Creating KFP client for host %s" % host)
        client = kfp.Client(host=host, client_id=client_id)

        # We'll None-check and fall back to a name taken from the pipeline below
        experiment_name = get('experiment_name', throw=False)

        pipeline_package_path = None
        delete = False

        try:
            # The provided pipeline can be a function (requiring compilation) or a string (URL):

            if callable(self.pipeline):
                # If the pipeline is a function, compile it to a .tar.gz

                if not experiment_name:
                    experiment_name = self.pipeline._pipeline_name
                    self.log.info('Using experiment name from @dsl.pipeline function: %s' % experiment_name)

                pipeline_package_path = NamedTemporaryFile(suffix=".tar.gz").name
                delete = True
                Compiler().compile(self.pipeline, pipeline_package_path)

            elif type(self.pipeline) == str:
                # If we were given a .tar.gz URL, check if it needs to be downloaded from GCS

                pipeline_package_path = self.pipeline

                if not experiment_name:
                    experiment_name = basename(pipeline_package_path)
                    self.log.info('Using experiment name from pipeline tar.gz path: %s' % experiment_name)

                url = urlparse(pipeline_package_path)
                if url.scheme == 'gs':
                    # Download from GCS
                    from google.cloud import storage
                    from google.cloud.storage import Bucket, Blob

                    storage_client = storage.Client()
                    bucket = Bucket(storage_client, url.netloc)
                    # drop leading slash, cf. https://github.com/googleapis/google-cloud-python/issues/8301
                    path = url.path[1:]
                    blob = Blob(path, bucket)
                    pipeline_package_path = NamedTemporaryFile(suffix='.tar.gz').name
                    delete = True
                    self.log.info("Downloading pipeline %s to %s" % (pipeline_package_path, pipeline_package_path))
                    with open(pipeline_package_path, 'wb') as fd:
                        blob.download_to_file(fd)
            else:
                raise ValueError(
                    'Unrecognized pipeline type; expected str | function, got %s: %s' % (
                        type(self.pipeline),
                        self.pipeline))

            # Create the Kubeflow Pipelines experiment
            try:
                self.log.info("Attempting to create KFP experiment %s" % experiment_name)
                experiment = client.create_experiment(name=experiment_name)
            except ApiException:
                # If an experiment already exists, fetch it
                self.log.info("Caught ApiException; checking whether experiment %s already exists" % experiment_name)
                experiment = client.get_experiment(experiment_name=experiment_name)
                self.log.info("Found experiment %s" % experiment)

            params = self.params_fn(self.params, conf) or {}

            now = int(datetime.datetime.utcnow().timestamp() * 100000)
            job_name = self.job_name or '%s-%d' % (experiment_name, now)

            self.log.info('Running job %s with params: %s' % (job_name, params))
            run = client.run_pipeline(experiment.id, job_name, pipeline_package_path, params)
            id = run.id
            url = '%s/#/runs/details/%s' % (host, id)
            self.log.info('Job running: %s' % url)
            self.log.info('Polling job status every 1s…')

            def get_intervals():
                """Sleep-interval generator: 10x1s, 10x10s, ♾x60s"""
                intervals = [ 1, 10, 60 ]
                max_interval_reps = 10
                interval = None
                while True:
                    if intervals:
                        interval = intervals.pop(0)
                        for _ in range(max_interval_reps):
                            yield interval
                    else:
                        yield interval

            intervals = get_intervals()

            running_statuses = [ None, 'Pending', 'Running' ]
            failed_statuses = [ 'Failed', 'Error' ]
            success_statuses = [ 'Succeeded', 'Skipped' ]

            while True:
                run = client.get_run(id).run

                if run.status not in running_statuses:
                    break

                interval = intervals.__next__()
                self.log.info("Sleeping for %ds" % interval)
                sleep(interval)

            # Pending, Running, Succeeded, Skipped, Failed, Error
            if run.status in failed_statuses:
                raise ValueError(
                    'Pipeline %s failed with state: %s (error: %s)' % (
                        id,
                        run.status,
                        run.error or '???'
                    )
                )

            if run.status not in success_statuses:
                self.log.warn('Unrecognized status "%s": %s' % (run.status, run))

            self.log.info('Pipeline %s finished in state: %s' % (id, run.status))

            return url

        finally:
            if delete:
                os.remove(pipeline_package_path)


class KubeflowPipelinesPlugin(AirflowPlugin):
    """Add `KubeflowPipelineOperator` to a running Airflow instance."""
    name = 'kubeflow_pipelines'
    operators = [ KubeflowPipelineOperator ]
