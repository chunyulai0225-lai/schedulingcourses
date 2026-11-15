-- 臺南後壁旌忠廟藏頭籤詩線上抽籤：資料庫結構
-- 只保存三種東西：58 支籤的匿名抽出次數與圖片版本、主神照片版本、管理者名單。
-- 不保存任何個別使用者的抽籤或擲筊紀錄。

create extension if not exists pgcrypto with schema extensions;

-- ---------- 籤（固定 58 筆） ----------
create table public.fortunes (
  fortune_number   smallint primary key check (fortune_number between 1 and 58),
  draw_count       bigint not null default 0 check (draw_count >= 0),
  -- 圖片最後上傳時間；null 表示尚未上傳。前端用它判斷是否有圖，並作為快取版本號。
  image_updated_at timestamptz,
  updated_at       timestamptz not null default now()
);
insert into public.fortunes (fortune_number) select generate_series(1, 58);

-- ---------- 網站設定（固定 1 筆） ----------
create table public.site_settings (
  id                     smallint primary key default 1 check (id = 1),
  deity_photo_updated_at timestamptz,
  updated_at             timestamptz not null default now()
);
insert into public.site_settings default values;

-- ---------- 管理者 ----------
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ---------- 抽籤 ----------
-- 以 pgcrypto 的安全亂數從 1～58 均勻抽出一支（拒絕取樣，沒有模數偏差），
-- 並在同一個 UPDATE 中原子性地把該籤次數加 1。每呼叫一次只會加一次。
create function public.draw_fortune()
returns table (drawn_number smallint, image_updated_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  b bytea;
  v integer;
  n smallint;
begin
  loop
    b := extensions.gen_random_bytes(2);
    v := get_byte(b, 0) * 256 + get_byte(b, 1);   -- 0～65535
    exit when v < 65482;                          -- 65482 = 58 × 1129
  end loop;
  n := (v % 58 + 1)::smallint;

  return query
    update public.fortunes f
       set draw_count = f.draw_count + 1,
           updated_at = now()
     where f.fortune_number = n
    returning f.fortune_number, f.image_updated_at;
end;
$$;

-- ---------- 權限 ----------
alter table public.fortunes      enable row level security;
alter table public.site_settings enable row level security;
alter table public.admin_users   enable row level security;

-- 一般民眾：只能讀取「哪些籤已有圖片」與主神照片版本，看不到抽出次數。
revoke all on public.fortunes from anon, authenticated;
grant select (fortune_number, image_updated_at) on public.fortunes to anon, authenticated;
grant update (image_updated_at) on public.fortunes to authenticated;

create policy "fortunes readable" on public.fortunes for select using (true);
create policy "admin updates fortune images" on public.fortunes for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant update (deity_photo_updated_at, updated_at) on public.site_settings to authenticated;
create policy "settings readable" on public.site_settings for select using (true);
create policy "admin updates settings" on public.site_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.admin_users from anon, authenticated;
-- 管理者名單只能在 Supabase 控制台以 SQL 新增，前端無法讀寫。

-- 抽出次數只有管理者能看：以函式提供，非管理者呼叫會被拒絕。
create function public.get_draw_statistics()
returns table (fortune_number smallint, draw_count bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '沒有管理權限' using errcode = '42501';
  end if;
  return query select f.fortune_number, f.draw_count from public.fortunes f order by f.fortune_number;
end;
$$;

revoke all on function public.is_admin()            from public;
revoke all on function public.draw_fortune()        from public;
revoke all on function public.get_draw_statistics() from public;
grant execute on function public.is_admin()            to anon, authenticated;
grant execute on function public.draw_fortune()        to anon, authenticated;
grant execute on function public.get_draw_statistics() to authenticated;

-- ---------- 圖片儲存空間 ----------
-- 公開讀取；只有管理者可上傳或更換。
-- 路徑：fortunes/001 … fortunes/058（籤詩圖片）、site/deity（主神照片）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "admin reads images" on storage.objects for select to authenticated
  using (bucket_id = 'images' and public.is_admin());
create policy "admin uploads images" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and public.is_admin());
create policy "admin replaces images" on storage.objects for update to authenticated
  using (bucket_id = 'images' and public.is_admin()) with check (bucket_id = 'images' and public.is_admin());
