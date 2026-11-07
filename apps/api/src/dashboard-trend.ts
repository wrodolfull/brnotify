import {query} from './db.js';

/** DAY exige AS como alias no PostgreSQL; series_day evita ambiguidade. */
export const DASHBOARD_TREND_SQL = `
  with zone as (select timezone from tenants where id=$1),
  days as (
    select generate_series(
      ((now() at time zone z.timezone)::date - 13)::timestamp,
      ((now() at time zone z.timezone)::date)::timestamp,
      interval '1 day'
    )::date AS series_day
    from zone z
  ),
  dispatch_messages as (
    select tenant_id,status,sent_at,updated_at from scheduled_messages where tenant_id=$1
    union all
    select tenant_id,status,sent_at,updated_at from on_demand_messages where tenant_id=$1
  ),
  accepted as (
    select (m.sent_at at time zone t.timezone)::date AS series_day, count(*)::int AS total
    from dispatch_messages m join tenants t on t.id=m.tenant_id
    where m.tenant_id=$1 and m.sent_at>=now()-interval '15 days'
    group by 1
  ),
  delivered as (
    select (m.updated_at at time zone t.timezone)::date AS series_day, count(*)::int AS total
    from dispatch_messages m join tenants t on t.id=m.tenant_id
    where m.tenant_id=$1 and m.status='delivered' and m.updated_at>=now()-interval '15 days'
    group by 1
  ),
  failed as (
    select (m.updated_at at time zone t.timezone)::date AS series_day, count(*)::int AS total
    from dispatch_messages m join tenants t on t.id=m.tenant_id
    where m.tenant_id=$1 and m.status='failed' and m.updated_at>=now()-interval '15 days'
    group by 1
  )
  select to_char(d.series_day,'YYYY-MM-DD') AS day,
    coalesce(a.total,0)::int AS sent,
    coalesce(v.total,0)::int AS delivered,
    coalesce(f.total,0)::int AS failed
  from days d left join accepted a on a.series_day=d.series_day
  left join delivered v on v.series_day=d.series_day
  left join failed f on f.series_day=d.series_day
  order by d.series_day asc
`;

export function loadDashboardTrend(tenantId:string){
  return query(DASHBOARD_TREND_SQL,[tenantId]);
}
