import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {localD1} from './local-d1.mjs';
import {validateTeams} from '../worker/index.js';
const root=new URL('../',import.meta.url);
const snapshot=JSON.parse(readFileSync(new URL('data/team-list-snapshot.json',root),'utf8'));
const teams=validateTeams(snapshot.teams);
mkdirSync(new URL('.local/',root),{recursive:true});
const DB=localD1(fileURLToPath(new URL('.local/leaderboard.sqlite',root)));
try{
 const existing=await DB.prepare('SELECT revision FROM leaderboard_settings WHERE id = 1').first();
 if(existing)throw new Error('A local team list already exists. It has not been overwritten.');
 await DB.prepare('INSERT INTO leaderboard_settings (id, teams_json, revision, updated_at) VALUES (1, ?, 1, ?)').bind(JSON.stringify(teams),new Date().toISOString()).run();
 console.log('Restored '+teams.length+' teams into the local preview only.');
}finally{DB.close();}
