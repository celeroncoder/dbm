# Redis example

```text
HSET note:1 body "hello" pinned true
HGETALL note:1
```

Choose `note:1` in Browse to inspect the hash. The default managed image is
`redis:7-alpine` and its native client is `redis-cli`.
