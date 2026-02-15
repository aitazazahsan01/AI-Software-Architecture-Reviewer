import express from 'express';

const app = express();

app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id });
});

app.post('/users', (req, res) => {
  res.status(201).json({ created: true });
});

export default app;
