# MongoDB example

```javascript
db.notes.insertOne({ id: 1, body: "hello" })
db.notes.find({}).toArray()
```

Choose the `notes` collection in Browse to inspect the document. The default
managed image is `mongo:7` and its native client is `mongosh`.
