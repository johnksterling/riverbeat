import { initDatabase } from './db.ts';
import { createApp } from './app.ts';

const PORT = Number(process.env.PORT ?? 3001);
const db = initDatabase();
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`RiverBeat API server listening on http://localhost:${PORT}`);
});
