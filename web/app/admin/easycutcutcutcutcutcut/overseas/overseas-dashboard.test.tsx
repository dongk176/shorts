import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OverseasDashboard } from "./overseas-dashboard";
import { overseasPath, type OverseasData } from "@/lib/admin-overseas-contract";

vi.mock("../admin-shell.module.css",()=>({default:new Proxy({},{get:(_target,key)=>String(key)})}));
vi.mock("./overseas.module.css",()=>({default:new Proxy({},{get:(_target,key)=>String(key)})}));

const data:OverseasData = {
  filters:{tab:"overview",query:"",page:1},total:0,pages:1,rows:[],
  metrics:{members:0,activeSubscriptions:0,projects:0,recentProjects:0},
  sales:["USD","JPY"].map(currency=>({currency:currency as "USD"|"JPY",gross:0,refunded:0,chargeback:0,pending:0,today:0,orders:0})),
  activity:[],
};
describe("overseas administrator interface",()=>{
  it("keeps navigation and searches within the overseas page",()=>{
    const html=renderToStaticMarkup(<OverseasDashboard data={data}/>);
    const links=[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]);
    expect(links.every(href=>href.startsWith(overseasPath))).toBe(true);
    expect(html).not.toContain("해외 고객 문의");
    expect(html).toContain(`action="${overseasPath}"`);
    expect(html).toContain("표시할 해외 데이터가 없습니다");
    expect(html).toContain("실제 거주 국가를 보증하지 않습니다");
    expect(html).not.toContain("/api/admin/");
  });
  it("escapes user text and keeps the query in pagination links",()=>{
    const html=renderToStaticMarkup(<OverseasDashboard data={{...data,filters:{tab:"projects",query:"alex",page:1},pages:2,total:31,
      rows:[{id:"1",email:"alex@example.test",name:null,label:'<script>alert("x")</script>',status:"new",createdAt:"2026-10-26T00:00:00Z",currency:null,amount:null}]}}/>);
    expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("tab=projects&amp;q=alex&amp;page=2");
  });
});

// Generate a local-only visual fixture when explicitly requested by the check.
// No fixture route or authentication bypass is added to the application.
if(process.env.OVERSEAS_VISUAL_OUTPUT) {
  it("exports a synthetic local visual fixture",async()=>{
    const {readFileSync,writeFileSync,mkdirSync}=await import("node:fs");
    const dir=process.env.OVERSEAS_VISUAL_OUTPUT!;mkdirSync(dir,{recursive:true});
    const fixture:OverseasData={...data,total:126,metrics:{members:126,activeSubscriptions:42,projects:389,recentProjects:3},
      sales:[{currency:"USD",gross:287400,refunded:11900,chargeback:0,pending:0,today:15960,orders:86},{currency:"JPY",gross:198240,refunded:5900,chargeback:0,pending:0,today:5900,orders:61}],
      activity:Array.from({length:14},(_,i)=>({date:`2026-10-${String(i+13).padStart(2,"0")}`,members:[2,4,1,7,3,5,6,4,8,5,7,9,6,10][i],projects:[5,9,4,14,8,11,15,12,17,13,18,21,15,24][i]})),
      rows:[{id:"demo-a",email:"alex@example.test",name:"Alex Morgan",label:"해외 이용 확인",status:"member",createdAt:"2026-10-26T15:42:00Z",currency:null,amount:null},{id:"demo-b",email:"yuki@example.test",name:"Yuki Tanaka",label:"해외 이용 확인",status:"member",createdAt:"2026-10-26T12:15:00Z",currency:null,amount:null}]};
    const css=readFileSync(new URL("../admin-shell.module.css",import.meta.url),"utf8")+readFileSync(new URL("./overseas.module.css",import.meta.url),"utf8");
    const html=renderToStaticMarkup(<OverseasDashboard data={fixture}/>);
    writeFileSync(`${dir}/index.html`,`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>해외 관리자 · 가상 데이터 미리보기</title><style>*{box-sizing:border-box}body{margin:0;background:#080a0f;font-family:Arial,sans-serif}p,h1,h2,h3{margin:0}a{color:inherit;text-decoration:none}button,input{font:inherit}button{color:inherit;border:0}dl,dd{margin:0}button,summary{cursor:pointer}${css}</style>${html}</html>`);
  });
}
