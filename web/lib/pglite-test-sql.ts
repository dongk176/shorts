import type { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import type { Sql } from "postgres";
type Fragment={strings:TemplateStringsArray;values:unknown[]};
function compile(fragment:Fragment,values:unknown[]=[]):{text:string;values:unknown[]} {
  let text=fragment.strings[0];
  fragment.values.forEach((value,index)=>{
    if(value&&typeof value==='object'&&'strings' in value)text+=compile(value as Fragment,values).text;
    else {values.push(value);text+=`$${values.length}`;}
    text+=fragment.strings[index+1];
  });
  return {text,values};
}
// Match postgres.js's lazy nested SQL fragments while executing the real SQL
// against PostgreSQL/WASM. This does not simulate concurrent connection locks.
export function pgliteTestSql(engine:()=>Pick<PGlite,'query'>,locksAsAcquired=false):Sql {
  return ((strings:TemplateStringsArray,...values:unknown[])=>({strings,values,
    then:(resolve:(rows:unknown[])=>unknown,reject:(error:unknown)=>unknown)=>{
      const q=compile({strings,values});
      if(locksAsAcquired&&/pg_(try_)?advisory_xact_lock/.test(q.text))return Promise.resolve([{acquired:true}]).then(resolve,reject);
      return engine().query<Record<string,unknown>>(q.text,q.values).then(({rows})=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v])))).then(resolve,reject);
    },
  })) as unknown as Sql;
}
