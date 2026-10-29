import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import worker from '../worker/index.js';

test('platform tabs switch guides and support keyboard focus without network requests',async()=>{
 const html=await (await worker.fetch(new Request('https://app.test/sign-up'))).text();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 let focused=null;
 class Element extends EventTarget{
  constructor(id){super();this.id=id;this.attributes={};this.hidden=false;}
  setAttribute(name,value){this.attributes[name]=value;}
  focus(){focused=this.id;}
 }
 const elements=new Map();
 const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);}};
 runInNewContext(script,{document});
 const justgiving=elements.get('justgiving-tab'),movember=elements.get('movember-tab');
 const justgivingPanel=elements.get('justgiving-panel'),movemberPanel=elements.get('movember-panel');
 assert.equal(justgiving.attributes['aria-selected'],'true');
 assert.equal(justgivingPanel.hidden,false);assert.equal(movemberPanel.hidden,true);
 assert.equal(justgivingPanel.attributes['aria-labelledby'],'justgiving-tab');
 movember.dispatchEvent(new Event('click'));
 assert.equal(movember.attributes['aria-selected'],'true');
 assert.equal(justgivingPanel.hidden,true);assert.equal(movemberPanel.hidden,false);
 const key=(element,value)=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value});element.dispatchEvent(event);assert.equal(event.defaultPrevented,true);};
 key(movember,'ArrowLeft');assert.equal(focused,'justgiving-tab');
 key(justgiving,'ArrowLeft');assert.equal(focused,'movember-tab');
 key(movember,'Home');assert.equal(focused,'justgiving-tab');
 key(justgiving,'End');assert.equal(focused,'movember-tab');
 assert.equal(movember.tabIndex,0);assert.equal(justgiving.tabIndex,-1);
});
