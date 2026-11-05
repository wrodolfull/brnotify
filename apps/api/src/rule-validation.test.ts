import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ruleInput} from './rule-validation.js';

const rule={
 slot:1,enabled:true,offset_value:1,offset_unit:'days',
 send_time:'09:00:00',template_id:null
};
test('PUT /api/reminder-rules accepts PostgreSQL TIME (HH:mm:ss)',()=>{
 const input=[rule,{...rule,slot:2,send_time:'15:45'},{...rule,slot:3,send_time:'21:15:00'}];
 const parsed=ruleInput.parse(input);
 assert.deepEqual(parsed.map(x=>x.send_time),['09:00','15:45','21:15']);
});
test('invalid clock values and malformed input return validation errors',()=>{
 for(const time of ['25:00','09:60','9:00','09:00:99','09:00:00Z','invalid']){
  assert.equal(ruleInput.safeParse([rule,{...rule,slot:2,send_time:time},{...rule,slot:3}]).success,false,time);
 }
});
