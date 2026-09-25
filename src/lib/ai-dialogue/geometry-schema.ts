import { z } from "zod";
export const RegionSchema = z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).strict().refine(r=>r.x+r.width<=1.001 && r.y+r.height<=1.001,"INVALID_REGION");
const point=z.string().trim().min(1).max(12).regex(/^[A-Za-z][A-Za-z0-9_']*$/);
export const AngleSchema=z.object({label:z.string().trim().min(1).max(24),vertex:point,arms:z.tuple([point,point]),region:RegionSchema.optional()}).strict().refine(a=>new Set([a.vertex,...a.arms]).size===3,"DEGENERATE_ANGLE");
export const GeometrySchema=z.object({regions:z.array(RegionSchema).max(3),angles:z.array(AngleSchema).max(24)}).strict().refine(g=>new Set(g.angles.map(a=>a.label)).size===g.angles.length,"DUPLICATE_ANGLE_LABEL");
export type GeometryEvidence=z.infer<typeof GeometrySchema>;
export type ImageRegion=z.infer<typeof RegionSchema>;
