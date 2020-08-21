[![Build Status](https://dev.azure.com/willsmythe/caching-templates/_apis/build/status/willsmythe.caching-templates?branchName=master)](https://dev.azure.com/willsmythe/caching-templates/_build/latest?definitionId=54&branchName=master)



# Caching templates

This repo provides Azure Pipelines templates and other tools related to [pipeline caching](https://aka.ms/pipeline-caching-docs).

## Pack cache contents as tar/zip

These steps simplify the process of packing cached files into a single "tar" file (on Linux and macOS) or "zip" file on Windows. This can improve performance in scenarios where caching a single large file performs better than caching thousands of small files. See [10925: Pack pipeline cache contents using tar/7z](https://github.com/microsoft/azure-pipelines-tasks/issues/10925) for more details.

### Requirements

1. Make sure you have a working pipeline that uses the `CacheBeta@0` task. See [pipeline caching](https://aka.ms/pipeline-caching-docs) for steps.

2. If your pipeline runs on a Microsoft-hosted agent, no additional configuation or software is required.

3. If your pipeline runs on a self-hosted agent, make sure the following software is installed:
   * Git
   * Node.js 8.x or higher
   * `tar` in your $PATH (for Linux or macOS)
   * `7z` in your %PATH% (for Windows)

### Limitations

1. Currently only works with jobs that have a single `CacheBeta@0` step

2. For container jobs, the same software required for self-hosted agents (see above) is required in the container

### Step 1: import steps into your pipeline

To simplify the process of packing and upacking the contents of a cache during the execution of your pipeline, [step templates](https://docs.microsoft.com/azure/devops/pipelines/process/templates?view=azure-devops#using-other-repositories) have been created and need to be added at various points within your job. 

You first need to add a [repository resource](https://docs.microsoft.com/azure/devops/pipelines/yaml-schema?view=azure-devops&tabs=schema#resources) to the https://github.com/willsmythe/caching-templates/ repository. This allows its step templates to be referenced in the `steps` section of your job:

```yaml
resources:
  repositories:
  - repository: caching-templates
    type: github
    name: willsmythe/caching-templates
    endpoint: github
```

> Note: If you do not have a `github` service connection in the project hosting your pipeline (or you do not have access to it), you can create one via Project Settings. Just make sure the name of this service connection is specifed in the `endpoint` field. See [service connections](https://docs.microsoft.com/azure/devops/pipelines/library/service-endpoints?view=azure-devops&tabs=yaml) for more details.

### Step 2: set cache variables

The imported step templates (see step 1) that handle packing and unpacking cache contents require specific environment variables to be set: `CACHE_KEY` and `CACHE_PATH`. `CACHE_PACK` also needs to be set to `true`, otherwise no packing or unpacking will occur.

Just copy the values from your existing `CacheBeta@0` step and define as variables at either the pipeline or job level:

```yaml
variables:
  CACHE_PACK: true
  CACHE_PATH: $(Build.SourcesDirectory)/path/to/cache
  CACHE_KEY: |
    package-lock.json
    $(Agent.OS)
    $(CACHE_PACK)
```

To avoid conflicts with any existing caches, the example above added the `$(CACHE_PACK)` variable to the cache key. This ensures a new, unique cache key.

Update your `CacheBeta@0` step to reference these variables:

```yaml
- task: CacheBeta@0
  inputs:
    key: $(CACHE_KEY)
    path: $(CACHE_PATH)
    cacheHitVar: CACHE_RESTORED
```

As shown in the example above, also set the `cacheHitVar` input to `CACHE_RESTORED`. 

### Step 3: wrap your existing cache step with new steps

Wrap your existing `CacheBeta@0` step with "pre-restore" and "post-restore" steps:

```yaml
steps:

###############################################################
# pre-restore (run just before the cache step
- template: pack/pre-restore-steps.yml@caching-templates
###############################################################

- task: CacheBeta@0
  inputs:
    key: $(CACHE_KEY)
    path: $(CACHE_PATH)
    cacheHitVar: CACHE_RESTORED

###############################################################
# post restore (run just after the cache step)
- template: pack/post-restore-steps.yml@caching-templates
###############################################################
```

The "pre-restore" step changes the `CACHE_PATH` envioronment variable to a temporary directory where the tar/zip will live when it is created or when it is restored on a cache hit.

The "post-restore" step unpacks the tar/zip restored by the `CacheBeta@0` step into your original `CACHE_PATH` directory.

### Step 4: add the step that creates the tar/zip

Add the following step (which create a tar/zip for the files you want to cache) to the end of your job. The post-job "save cache" step will then upload this file as the contents of the cache.

```yaml
steps:

# all other steps 


###############################################################
# pre-save (run at the end of the job)
- template: pack/pre-save-steps.yml@caching-templates
###############################################################
```

### Step 5: run your pipeline
1
If you run into a problem and need help, open an issue at [willsmythe/caching-templates](https://github.com/willsmythe/caching-templates/issues).
