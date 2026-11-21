// A replacement is another version of the same test. A separately created
// test keeps its own identity, even when its title happens to be identical.
const identity=value=>String(value??'');
// Some Apps Script runtimes omit Intl; the same module is embedded in Code.gs.
const compareIds=typeof Intl==='object'&&typeof Intl.Collator==='function'?new Intl.Collator('en',{numeric:true}).compare:(a,b)=>a.localeCompare(b,'en',{numeric:true});
export function testSeriesResolver(tests=[]) {
 const parents=new Map();
 for(const test of tests)if(identity(test.id))parents.set(identity(test.id),identity(test.canonicalTestId||test.replacesId||test.id));
 return value=>{
  let current=identity(value);const seen=new Set();
  while(parents.has(current)&&parents.get(current)!==current){
   if(seen.has(current))return identity(value); // Never merge corrupt cycles.
   seen.add(current);current=parents.get(current);
  }
  return current;
 };
}
export function resultTestKey(result,resolve=value=>identity(value)) {
 return resolve(result.canonicalTestId||result.testId);
}
export function compareAttempts(a,b) {
 return (Date.parse(a.completedAt)||0)-(Date.parse(b.completedAt)||0)
  ||compareIds(identity(a.id),identity(b.id));
}
export function latestResults(results,tests=[],{byGroup=true}={}) {
 const resolve=testSeriesResolver(tests),latest=new Map();
 for(const result of results){
  if(!result||!identity(result.userId)||!identity(result.testId))continue;
  const key=JSON.stringify([identity(result.userId),byGroup?String(result.groupName||''):'',resultTestKey(result,resolve)]);
  const previous=latest.get(key);
  if(!previous||compareAttempts(result,previous)>0)latest.set(key,result);
 }
 return [...latest.values()].sort((a,b)=>compareAttempts(b,a));
}
