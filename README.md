# Caching step templates

## Packing (tar/7z)

To cache a tar (on posix) or 7z for the cache path:

1. Set the following variables in your pipeline or job based on the existing values in your `CacheBeta@0` step:

```yaml
variables:
  CACHE_PACK: true
  CACHE_PATH: /path/to/cache
  CACHE_KEY: mykey
```

2. Update your `CacheBeta@0` step to reference these new variables:

```yaml
- task: CacheBeta@0
  inputs:
    key: $(CACHE_KEY)
    path: $(CACHE_PATH)
```

3. Add the `caching-templates` repo as a pipeline resource so we can use its step templates:

```yaml
resources:
  repositories:
  - repository: caching-templates
    type: git
    name: caching-templates
```

3. Wrap your `CacheBeta@0` step with steps from the caching-templates repo:

```yaml
steps:

# pre-restore step
- template: pack/pre-restore-steps.yml@caching-templates

# existing cache step
- task: CacheBeta@0
  inputs:
    key: $(CACHE_KEY)
    path: $(CACHE_PATH)

# post restore step
- template: pack/post-restore-steps.yml@caching-templates
```

4. Add the following step to the end of your job:

```yaml
steps:

# ... all other steps

- template: pack/pre-save-steps.yml@caching-templates
```

