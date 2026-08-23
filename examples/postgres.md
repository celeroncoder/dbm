# Postgres example

```sql
CREATE TABLE notes (id integer primary key, body text not null);
INSERT INTO notes (id, body) VALUES (1, 'hello');
SELECT * FROM notes ORDER BY id;
```

Choose `public.notes` in Browse to inspect the seeded row. The default managed
image is `postgres:16-alpine` and its native client is `psql`.
