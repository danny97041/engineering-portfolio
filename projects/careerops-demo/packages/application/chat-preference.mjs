import { check, object, string } from '../domain/contracts.mjs';
import { transaction } from '../database/transaction.mjs';

const setting='personalization.chat';

export function chatPreference(service,actor){
  service.authorize(actor,true);
  const row=service.db.prepare('SELECT value_json,version FROM app_settings WHERE key=?').get(setting);
  return row?{conversationUrl:JSON.parse(row.value_json),version:row.version}:{conversationUrl:null,version:0};
}

export function saveChatPreference(service,actor,version,input){
  service.authorize(actor,true);
  object(input);
  check(Object.keys(input).length===1&&Object.hasOwn(input,'conversationUrl'),'Expected conversationUrl');
  let url=null;
  if(input.conversationUrl!==null){
    const value=string(input.conversationUrl,400);
    check(URL.canParse(value),'Enter a ChatGPT conversation link');
    const parsed=new URL(value);
    const conversation=/^\/(?:g\/g-[a-zA-Z0-9_-]+\/)?c\/[a-zA-Z0-9_-]{8,100}\/?$/;
    check(parsed.origin==='https://chatgpt.com'&&!parsed.username&&!parsed.password&&conversation.test(parsed.pathname),
      'Use the existing private ChatGPT conversation URL');
    url=parsed.origin+parsed.pathname.replace(/\/$/,'');
  }
  return transaction(service.db,()=>{
    const current=chatPreference(service,actor);
    check(version===current.version,'Chat setting changed. Reload and retry.',409);
    if(current.conversationUrl===url) return current;
    service.db.prepare(`INSERT INTO app_settings(key,value_json,version) VALUES (?,?,1)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,version=app_settings.version+1`).run(setting,JSON.stringify(url));
    return {conversationUrl:url,version:current.version+1};
  });
}
