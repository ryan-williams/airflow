# Running Kubeflow Pipelines in Apache Airflow / Google Cloud Composer

## Create a Cloud Composer environment
The full docs are [here](https://cloud.google.com/composer/docs/how-to/managing/creating), but here are some shortcuts:

### Enable the composer API
```bash
gcloud services enable composer.googleapis.com
```

### Set a default zone for Composer to use
```bash
gcloud config set composer/location us-east1
```

### Create a Cloud Composer cluster ("environment")
```bash
ENV=my-env
gcloud composer environments create $ENV --python-version=3
```

This may take ≈20mins.

## Give Cloud Composer's service account "signBlob" and "IAP web user" privileges
Find Cloud Composer's service account:
```bash
SVCACCT="$(gcloud composer environments describe $ENV --format="get(config.nodeConfig.serviceAccount)")"
```

`signBlob` is necessary for uploading plugin and dag files to Google Cloud Storage (where Cloud Composer uses them):
```bash
gcloud projects add-iam-policy-binding "${PROJECT}" --member serviceAccount:"${SVCACCT}" --role roles/iam.serviceAccountTokenCreator
```

Allow Cloud Composer's service account to authenticate as an IAP-secured Web App User:
```bash
gcloud projects add-iam-policy-binding "${PROJECT}" --member serviceAccount:"${SVCACCT}" --role roles/iap.httpsResourceAccessor
```
See [IAP docs](https://cloud.google.com/iap/docs/managing-access) for more info.

## Install KFP-Airflow plugin and example DAGs

### Plugin (containing KubeflowPipelinesOperator)
```bash
base=https://raw.githubusercontent.com/ryan-williams/airflow/kfp/airflow/contrib
wget $base/operators/gcp_kubeflow_pipeline.py
gcloud composer environments storage plugins import --environment $ENV --source gcp_kubeflow_pipeline.py
```

### Example DAGs:
```bash
wget $base/example_dags/example_kubeflow_pipeline_dag.py
gcloud composer environments storage dags import --environment $ENV --source example_kubeflow_pipeline_dag.py
wget $base/example_dags/example_kubeflow_compile_pipeline_dag.py
gcloud composer environments storage dags import --environment $ENV --source example_kubeflow_compile_pipeline_dag.py
```

## Configure Cloud Composer variables to point at an existing Kubeflow cluster

```bash
gcloud composer environments run $ENV variables -- --set KUBEFLOW_HOST "https://${KFAPP}.endpoints.${PROJECT}.cloud.goog/pipeline"
gcloud composer environments run $ENV variables -- --set KUBEFLOW_OAUTH_CLIENT_ID "$IAP_OAUTH_CLIENT_ID"
```

See [the Kubeflow quickstart](https://www.kubeflow.org/docs/gke/deploy/deploy-cli/) for information about setting up a Kubeflow cluster and obtaining the placeholder values for the cluster location (`$KFAPP`, `$PROJECT`) as well as OAuth ID (`$IAP_OAUTH_CLIENT_ID`).

## Navigate to Cloud Composer Web UI

### Find the web UI:
```bash
gcloud composer environments describe $ENV --format="get(config.airflowUri)"
```

### Open in browser:

[![Cloud Composer / Airflow homepage](https://cl.ly/98b52dfdf552/Screen%20Shot%202019-06-24%20at%2012.30.02%20AM.png)](https://cl.ly/98b52dfdf552/Screen%20Shot%202019-06-24%20at%2012.30.02%20AM.png)

Note the custom Kubeflow Pipelines example DAGs:
- `example_kubeflow_compile_pipeline_operator` ([github](https://raw.githubusercontent.com/ryan-williams/airflow/kfp/airflow/contrib/example_dags/example_kubeflow_compile_pipeline_dag.py))
- `example_kubeflow_pipeline_operator` ([github](https://raw.githubusercontent.com/ryan-williams/airflow/kfp/airflow/contrib/example_dags/example_kubeflow_pipeline_dag.py))

## Trigger a simple Kubeflow Pipeline from Cloud Composer web UI
The `example_kubeflow_pipeline_operator` example DAG runs a pipeline, [`coin.tar.gz`](https://storage.googleapis.com/ml-pipeline-playground/coin.tar.gz), with no additional inputs, so we can trigger a run from the web UI:

[![Homepage showing "Trigger Dag" button](https://cl.ly/2076214826d6/[37736f19eb4baace4b90afc9b3239480]_Screen%20Shot%202019-06-24%20at%2012.31.02%20AM.png)](https://cl.ly/2076214826d6/[37736f19eb4baace4b90afc9b3239480]_Screen%20Shot%202019-06-24%20at%2012.31.02%20AM.png)

Click "Trigger Dag" as shown, and a run will appear:

[![Homepage showing a "Running" example DAG](https://cl.ly/d905250523ee/[ab427e0b67f4c49e8704b1c8e442f65a]_Screen%20Shot%202019-06-24%20at%2012.35.30%20AM.png)](https://cl.ly/d905250523ee/[ab427e0b67f4c49e8704b1c8e442f65a]_Screen%20Shot%202019-06-24%20at%2012.35.30%20AM.png)

Refresh about a minute later, and you should see a "success" run in the "Recent Tasks" column:

[![Homepage showing a recent success of an example DAG](https://cl.ly/7977176453c2/[ae37c5b84b66b21ac6db48393fe42b6c]_Screen%20Shot%202019-06-24%20at%2012.36.46%20AM.png)](https://cl.ly/7977176453c2/[ae37c5b84b66b21ac6db48393fe42b6c]_Screen%20Shot%202019-06-24%20at%2012.36.46%20AM.png)

Click on that successful run, and you'll see a table with recent successful runs of this DAG:

[![Recent successful example DAG runs, with "Log Url" link annotated](https://cl.ly/2f5313b5a7a1/[b16f74f02e87e330e78e66be10dd949f]_Screen%20Shot%202019-06-24%20at%2012.39.18%20AM.png)](https://cl.ly/2f5313b5a7a1/[b16f74f02e87e330e78e66be10dd949f]_Screen%20Shot%202019-06-24%20at%2012.39.18%20AM.png)

Scroll all the way on the right and click on the "Log Url":

[![Example DAG logs page, showing URL to Kubeflow Pipelines web UI for the run](https://cl.ly/3231486ea992/[ea9c6fdf0f95ca93ff91a5c5dde196b0]_Screen%20Shot%202019-06-24%20at%2012.48.03%20AM.png)](https://cl.ly/3231486ea992/[ea9c6fdf0f95ca93ff91a5c5dde196b0]_Screen%20Shot%202019-06-24%20at%2012.48.03%20AM.png)

Some basic logs about the execution are here; in particular, the last line gives a link to the Kubeflow Pipelines web UI's "run details" page for the pipeline that was run as part of this Airflow DAG. Copying and navigating to that link:

[![Kubeflow Pipelines web UI](https://cl.ly/647fccec88d1/Screen%20Shot%202019-06-24%20at%2012.51.20%20AM.png)](https://cl.ly/647fccec88d1/Screen%20Shot%202019-06-24%20at%2012.51.20%20AM.png)

We see the Kubeflow Pipelines DAG, input/output, logs, etc.! 🎉

## Trigger an example DAG from the command-line

The [`example_kubeflow_compile_pipeline_operator`](https://raw.githubusercontent.com/ryan-williams/airflow/kfp/airflow/contrib/example_dags/example_kubeflow_compile_pipeline_dag.py) DAG defines a Kubeflow Pipeline using the `@dsl.pipeline` annotation:

```python
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
```

It then calls the ``, passing any DAG-run configuration values as parameters to the Kubeflow Pipeline:

```python
KubeflowPipelineOperator(
    pipeline=sequential_pipeline,
    params_fn=lambda params, conf: conf,
    task_id='kubeflow-pipeline',
    dag=dag
)
```

`params` are Airflow parameters, which can be set on the DAG or operator constructor calls. Here they're both empty, as we will pass in the pipeline's required input `filename` using the DAG-run configuration CLI flag:

```bash
gcloud composer environments run $ENV trigger_dag -- example_kubeflow_compile_pipeline_operator -c '{"filename":"gs://ml-pipeline-playground/trainconfbin.json"}'
```

Again, we see a "running" entry in the "Recent Tasks" column, this time for the `example_kubeflow_compile_pipeline_operator` row:

[![Homepage showing the example_kubeflow_compile_pipeline_operator example DAG running](https://cl.ly/80e8f94bb860/[cc0d5d273ca578e25c1db41512ed4551]_Screen%20Shot%202019-06-24%20at%201.11.41%20AM.png)](https://cl.ly/80e8f94bb860/[cc0d5d273ca578e25c1db41512ed4551]_Screen%20Shot%202019-06-24%20at%201.11.41%20AM.png)

Refreshing a few times, you should see it succeed. Clicking on the "success" counter, and then the "Log Url", you'll see the Kubeflow Pipelines link again:

[![Kubeflow Pipelines web UI showing completed task and output](https://cl.ly/f0730407a4b8/[d557909bb82e8493de2bd77d22b4ffde]_Screen%20Shot%202019-06-24%20at%201.14.41%20AM.png)](https://cl.ly/f0730407a4b8/[d557909bb82e8493de2bd77d22b4ffde]_Screen%20Shot%202019-06-24%20at%201.14.41%20AM.png)

The output path is indeed the one that we passed as input on the CLI, `gs://ml-pipeline-playground/trainconfbin.json` 🎉.
