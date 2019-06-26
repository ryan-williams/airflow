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

"""Example DAG that runs a Kubeflow Pipeline (given by URL) on a Kubeflow cluster."""

from datetime import timedelta

import airflow
from airflow.models import DAG
from airflow.operators.kubeflow_pipelines import KubeflowPipelineOperator


args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'start_date': airflow.utils.dates.days_ago(2),
}

dag = DAG(
    dag_id='kubeflow_pipelines_coin_example',
    default_args=args,
    schedule_interval='@once',
    dagrun_timeout=timedelta(minutes=60),
)


KubeflowPipelineOperator(
    pipeline='gs://ml-pipeline-playground/coin.tar.gz',
    experiment_name="kfp coin demo",
    task_id='kubeflow-pipeline',
    dag=dag
)


if __name__ == "__main__":
    dag.cli()
