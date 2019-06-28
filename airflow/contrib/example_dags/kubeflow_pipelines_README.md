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

## Configure KFP-Airflow plugin, example DAGs, and variables

### Install the Kubeflow Pipelines package on the Cloud Composer server
```bash
gcloud composer environments update $ENV --update-pypi-package=kfp
```

### Fetch the operator and example DAGs
```bash
wget https://raw.githubusercontent.com/ryan-williams/airflow/kfp/airflow/contrib/operators/gcp_kubeflow_pipeline.py
wget https://raw.githubusercontent.com/ryan-williams/airflow/kfp/airflow/contrib/example_dags/kubeflow_pipelines_coin_example.py
wget https://raw.githubusercontent.com/ryan-williams/airflow/kfp/airflow/contrib/example_dags/kubeflow_pipelines_sequential_example.py
```

### Import them into Cloud Composer
```bash
gcloud composer environments storage plugins import --environment $ENV --source gcp_kubeflow_pipeline.py
gcloud composer environments storage dags import --environment $ENV --source kubeflow_pipelines_coin_example.py
gcloud composer environments storage dags import --environment $ENV --source kubeflow_pipelines_sequential_example.py
```

### Configure Cloud Composer variables to point at an existing Kubeflow cluster
Tell Airflow where to find a Kubeflow cluster to run Pipelines on, and how to authenticate:
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

[![Cloud Composer / Airflow homepage](https://cl.ly/9d1dac4d441e/homepage.png)](https://cl.ly/9d1dac4d441e/homepage.png)

Note the custom Kubeflow Pipelines example DAGs:
- [`kubeflow_pipelines_coin_example`](https://github.com/ryan-williams/airflow/blob/kfp/airflow/contrib/example_dags/kubeflow_pipelines_coin_example.py#L35)
- [`kubeflow_pipelines_sequential_example`](https://github.com/ryan-williams/airflow/blob/kfp/airflow/contrib/example_dags/kubeflow_pipelines_sequential_example.py#L37)

## Trigger a simple Kubeflow Pipeline from Cloud Composer web UI
The `kubeflow_pipelines_coin_example` example DAG runs a pipeline, [`coin.tar.gz`](https://storage.googleapis.com/ml-pipeline-playground/coin.tar.gz), with no additional inputs, so we can trigger a run from the web UI:

[![Homepage showing "Trigger Dag" button](https://cl.ly/c231f1ea5c7c/trigger.png)](https://cl.ly/c231f1ea5c7c/trigger.png)

### Trigger DAG
Click "Trigger Dag" as shown, and a run will appear:

[![Homepage showing a "Running" example DAG](https://cl.ly/5226df43265e/running.png)](https://cl.ly/5226df43265e/running.png)

### Wait for success
Refresh about a minute later, and you should see a "success" run in the "Recent Tasks" column:

[![Homepage showing a recent success of an example DAG](https://cl.ly/99a494f18ef3/succeeded.png)](https://cl.ly/99a494f18ef3/succeeded.png)

### Navigate to Logs
Click on that successful run, and you'll see a table with recent successful runs of this DAG:

[![Recent successful example DAG runs, with "Log Url" link annotated](https://cl.ly/5f4360f11b4a/successes.png)](https://cl.ly/5f4360f11b4a/successes.png)

Scroll all the way on the right and click on the "Log Url":

### Find Kubeflow Pipelines web UI link

[![Example DAG logs page, showing URL to Kubeflow Pipelines web UI for the run](https://cl.ly/ece649dbbfe2/logs.png)](https://cl.ly/ece649dbbfe2/logs.png)

Some basic logs about the execution are here; in particular, the last line gives a link to the Kubeflow Pipelines web UI's "run details" page for the pipeline that was run as part of this Airflow DAG. Copying and navigating to that link:

[![Kubeflow Pipelines web UI](https://cl.ly/3fe326f2ea30/kfp.png)](https://cl.ly/3fe326f2ea30/kfp.png)

We see the Kubeflow Pipelines DAG, input/output, logs, etc.! 🎉

## Trigger an example DAG from the command-line

The [`kubeflow_pipelines_sequential_example`](https://github.com/ryan-williams/airflow/blob/kfp/airflow/contrib/example_dags/kubeflow_pipelines_sequential_example.py#L37) DAG defines a Kubeflow Pipeline using the `@dsl.pipeline` annotation:

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

The `params_fn` argument specifies that any "DAG run" configs will be passed to the Kubeflow Pipeline, allowing us to pass the pipeline's required input `filename` via the CLI when running with the `trigger_dag` command:

```bash
gcloud composer environments run $ENV trigger_dag -- \
    kubeflow_pipelines_sequential_example \
    -c '{"filename":"gs://ml-pipeline-playground/trainconfbin.json"}'
```

Again, we see a "running" entry in the "Recent Tasks" column, this time for the `kubeflow_pipelines_sequential_example` row:

[![Homepage showing the kubeflow_pipelines_sequential_example DAG running](https://cl.ly/3f37be1bea45/running.png)](https://cl.ly/3f37be1bea45/running.png)

Refreshing a few times, you should see it succeed. Clicking on the "success" counter, and then the "Log Url", you'll see the Kubeflow Pipelines link again:

[![Kubeflow Pipelines web UI showing completed task and output](https://cl.ly/59fc045f9566/kfp.png)](https://cl.ly/59fc045f9566/kfp.png[d557909bb82e8493de2bd77d22b4ffde]_Screen%20Shot%202019-06-24%20at%201.14.41%20AM.png)

The output path is indeed the one that we passed as input on the CLI, `gs://ml-pipeline-playground/trainconfbin.json` 🎉.
