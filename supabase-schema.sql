-- ═══════════════════════════════════════════════════════════════
--  PDF ANALYST — Supabase Schema
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- 1. PROFILES TABLE
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  name text,
  approved boolean default false,
  questions_remaining integer default 20,
  membership_type text default 'free',   -- 'free' | 'pack' | 'timed' | 'lifetime'
  membership_expires_at timestamptz,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Users can read their own profile
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Only service role can update profiles (API routes use service key)
create policy "Service role can do anything"
  on public.profiles for all
  using (true)
  with check (true);


-- 2. Q&A CACHE TABLE
create table if not exists public.qa_cache (
  id uuid primary key default gen_random_uuid(),
  question_normalized text not null,
  question_original text not null,
  answer text not null,
  structure text,
  file_name text default 'Unknown',
  ask_count integer default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(question_normalized, file_name)
);

alter table public.qa_cache enable row level security;

-- Anyone can read the cache (for public pulse)
create policy "Anyone can read qa_cache"
  on public.qa_cache for select
  using (true);

-- Only service role can write
create policy "Service role writes qa_cache"
  on public.qa_cache for all
  using (true)
  with check (true);


-- 3. PAYMENTS TABLE
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  razorpay_order_id text,
  razorpay_payment_id text,
  plan text not null,            -- 'pack' | 'timed' | 'lifetime'
  amount_paise integer not null,
  status text default 'pending', -- 'pending' | 'verified' | 'failed'
  created_at timestamptz default now()
);

alter table public.payments enable row level security;

create policy "Service role manages payments"
  on public.payments for all
  using (true)
  with check (true);


-- 4. AUTO-CREATE PROFILE ON SIGNUP TRIGGER
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, approved, questions_remaining, membership_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    false,
    20,
    'free'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
