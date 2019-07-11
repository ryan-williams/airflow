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

"""Example DAG that defines a Kubeflow Pipeline and submits it to a Kubeflow cluster."""

from datetime import timedelta

import airflow
from airflow.models import DAG
from airflow.operators.kubeflow_pipelines import KubeflowPipelineOperator

import kfp.dsl as dsl


args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'start_date': airflow.utils.dates.days_ago(2),
}

dag = DAG(
    dag_id='kubeflow_pipelines_sequential_example',
    default_args=args,
    schedule_interval='@once',
    dagrun_timeout=timedelta(minutes=60),
)


@dsl.pipeline(
    name='Sequential',
    description='A pipeline with two sequential steps.'
)
def sequential_pipeline(filename='gs://ml-pipeline-playground/shakespeare1.txt'):
    """A simple example pipeline with two sequential steps."""

    op1 = dsl.ContainerOp(
        name='getfilename',
        image='library/bash:4.4.23',
        command=['sh', '-c'],
        arguments=['echo "%s" > /tmp/results.txt' % filename],
        file_outputs={'newfile': '/tmp/results.txt'})
    op2 = dsl.ContainerOp(
        name='echo',
        image='library/bash:4.4.23',
        command=['sh', '-c'],
        arguments=['echo "%s"' % op1.outputs['newfile']]
    )

KubeflowPipelineOperator(
    pipeline=sequential_pipeline,
    params_fn=lambda _, conf: conf,
    task_id='kubeflow-pipeline',
    dag=dag
)


if __name__ == "__main__":
    dag.cli()