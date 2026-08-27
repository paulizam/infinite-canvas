import { describe, expect, it } from "vitest";
import { CANVAS_SCHEMA_VERSION, type CanvasDocument } from "@infinite-canvas/contracts";
import { applyCanvasOperations, migrateCanvasDocument } from ".";
const doc: CanvasDocument = { id:"p",schemaVersion:CANVAS_SCHEMA_VERSION,revision:2,title:"A",createdAt:"x",updatedAt:"x",nodes:[{id:"a",type:"text",title:"A",position:{x:0,y:0},width:1,height:1}],connections:[{id:"e",fromNodeId:"a",toNodeId:"b"}],chatSessions:[],activeChatId:null,backgroundMode:"lines",showImageInfo:false,viewport:{x:0,y:0,k:1} };
describe("canvas core",()=>{
  it("applies a batch with one revision",()=>{const next=applyCanvasOperations(doc,[{type:"node.move",nodeId:"a",position:{x:4,y:8}},{type:"document.patch",patch:{title:"B"}}]);expect(next.revision).toBe(3);expect(next.title).toBe("B");});
  it("removes dangling edges",()=>expect(applyCanvasOperations(doc,[{type:"node.remove",nodeIds:["a"]}]).connections).toEqual([]));
  it("migrates legacy data",()=>expect(migrateCanvasDocument({id:"old",nodes:doc.nodes}).schemaVersion).toBe(4));
  it("rejects documents without ids",()=>expect(()=>migrateCanvasDocument({})).toThrow(/id/));
});
