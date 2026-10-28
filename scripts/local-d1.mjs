// Local-only D1 adapter using Node's built-in SQLite. Never included in the Worker.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function localD1(filename=':memory:') {
  const sqlite=new DatabaseSync(filename);
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY NOT NULL)');
  const migrations=new URL('../drizzle/',import.meta.url);
  for(const name of readdirSync(migrations).filter(x=>x.endsWith('.sql')).sort()){
    if(sqlite.prepare('SELECT name FROM _local_migrations WHERE name = ?').get(name))continue;
    sqlite.exec('BEGIN');
    try{sqlite.exec(readFileSync(new URL(name,migrations),'utf8'));sqlite.prepare('INSERT INTO _local_migrations (name) VALUES (?)').run(name);sqlite.exec('COMMIT');}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
  return {
    prepare(sql){
      const statement=sqlite.prepare(sql);
      const bound=args=>({
        bind(...values){return bound(values);},
        async first(){return statement.get(...args)||null;},
        async all(){return {success:true,results:statement.all(...args)};},
        async run(){const result=statement.run(...args);return {success:true,meta:{changes:Number(result.changes)}};},
      });
      return bound([]);
    },
    close(){sqlite.close();},
  };
}
