import {z} from 'zod';

// PostgreSQL TIME fields are returned as HH:mm:ss. A browser time input
// usually emits HH:mm. Accept both at the API boundary, validate hours/minutes,
// and normalize to HH:mm before persisting.
export const ruleInput=z.array(z.object({
 slot:z.number().int().min(1).max(3),
 enabled:z.boolean(),
 offset_value:z.number().int().min(1).max(365),
 offset_unit:z.enum(['days','weeks','months']),
 send_time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).transform(value=>value.slice(0,5)),
 template_id:z.string().uuid().nullable().optional()
})).length(3);
