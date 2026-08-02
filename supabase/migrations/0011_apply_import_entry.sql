-- 0011_apply_import_entry.sql
--
-- One transactional entry point for the workbook importer.
--
-- The importer runs over HTTP through PostgREST, which gives one transaction
-- per request. A cell can produce several sessions with nested activities,
-- sets, intervals, circuits and benchmark splits, and a cell must be applied
-- all-or-nothing. Doing that from the client would mean either many
-- non-atomic requests or a service-role SQL connection; a single function
-- called with the whole cell payload gives a real transaction per cell.
--
-- Idempotency: the function DELETES any sessions previously imported from this
-- cell before inserting. Children cascade, so a rerun replaces the cell's rows
-- rather than duplicating them, and row counts are stable across runs. That is
-- equivalent to an upsert on client_request_key but avoids having to diff
-- nested collections.
--
-- The function is SECURITY INVOKER: it runs with the caller's rights, so RLS
-- still applies and it cannot be used to escape ownership rules.

create or replace function public.apply_import_entry(
    p_user_id uuid,
    p_batch_id uuid,
    p_cell jsonb,
    p_sessions jsonb
)
returns table (session_id uuid, client_request_key text)
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_sheet         text    := p_cell ->> 'sheet';
    v_row           integer := (p_cell ->> 'row')::integer;
    v_col           integer := (p_cell ->> 'col')::integer;
    v_session       jsonb;
    v_activity      jsonb;
    v_set           jsonb;
    v_interval      jsonb;
    v_movement      jsonb;
    v_split         jsonb;
    v_session_id    uuid;
    v_activity_id   uuid;
    v_circuit       jsonb;
    v_circuit_id    uuid;
    v_benchmark     jsonb;
    v_benchmark_id  uuid;
    v_key           text;
begin
    if p_user_id is null then
        raise exception 'apply_import_entry requires a user id';
    end if;

    -- Staging row: one per source cell, always. A changed checksum resets the
    -- review status so an edited cell is re-reviewed rather than silently kept.
    insert into public.import_entries (
        user_id, batch_id, sheet_name, source_row, source_col, cell_ref,
        week_label, inferred_local_date, raw_text, raw_text_sha256,
        extraction, warnings, unconsumed_lines, review_status, applied_at
    )
    values (
        p_user_id, p_batch_id, v_sheet, v_row, v_col, format('R%sC%s', v_row, v_col),
        p_cell ->> 'week_label',
        (p_cell ->> 'local_date')::date,
        p_cell ->> 'raw_text',
        p_cell ->> 'raw_text_sha256',
        coalesce(p_cell -> 'extraction', '{}'::jsonb),
        coalesce(p_cell -> 'warnings', '[]'::jsonb),
        coalesce(
            array(select jsonb_array_elements_text(coalesce(p_cell -> 'unconsumed_lines', '[]'::jsonb))),
            '{}'::text[]
        ),
        (p_cell ->> 'review_status')::public.import_review_status,
        now()
    )
    on conflict (user_id, sheet_name, source_row, source_col) do update
    set batch_id            = excluded.batch_id,
        cell_ref            = excluded.cell_ref,
        week_label          = excluded.week_label,
        inferred_local_date = excluded.inferred_local_date,
        raw_text            = excluded.raw_text,
        raw_text_sha256     = excluded.raw_text_sha256,
        extraction          = excluded.extraction,
        warnings            = excluded.warnings,
        unconsumed_lines    = excluded.unconsumed_lines,
        review_status       = case
                                  when public.import_entries.raw_text_sha256
                                       is distinct from excluded.raw_text_sha256
                                  then 'pending'::public.import_review_status
                                  else excluded.review_status
                              end,
        applied_at          = now(),
        updated_at          = now();

    -- Replace anything this cell produced on a previous run. Children cascade.
    delete from public.workout_sessions ws
    where ws.user_id = p_user_id
      and ws.client_request_key like format('import:%s:%s:%s:%%', v_sheet, v_row, v_col);

    for v_session in select * from jsonb_array_elements(p_sessions)
    loop
        v_key := v_session ->> 'clientRequestKey';

        insert into public.workout_sessions (
            user_id, local_date, started_at, title, source, raw_text, transcript,
            notes, duration_seconds, session_rpe, status, client_request_key
        )
        values (
            p_user_id,
            (v_session ->> 'localDate')::date,
            (v_session ->> 'startedAt')::timestamptz,
            v_session ->> 'title',
            (v_session ->> 'source')::public.session_source,
            coalesce(v_session ->> 'rawText', ''),
            v_session ->> 'transcript',
            v_session ->> 'notes',
            (v_session ->> 'durationSeconds')::numeric,
            (v_session ->> 'sessionRpe')::numeric,
            (v_session ->> 'status')::public.session_status,
            v_key
        )
        returning id into v_session_id;

        for v_activity in select * from jsonb_array_elements(v_session -> 'activities')
        loop
            insert into public.activities (
                user_id, session_id, sequence, modality, subtype, objective, intensity,
                duration_seconds, distance_km, calories, avg_heart_rate_bpm,
                max_heart_rate_bpm, cadence_spm, elevation_gain_m, avg_power_watts,
                external_load_kg, details, notes, original_text
            )
            values (
                p_user_id, v_session_id,
                (v_activity ->> 'sequence')::smallint,
                (v_activity ->> 'modality')::public.activity_modality,
                v_activity ->> 'subtype',
                (v_activity ->> 'objective')::public.training_objective,
                (v_activity ->> 'intensity')::public.intensity_level,
                (v_activity ->> 'durationSeconds')::numeric,
                (v_activity ->> 'distanceKm')::numeric,
                (v_activity ->> 'calories')::numeric,
                (v_activity ->> 'avgHeartRateBpm')::smallint,
                (v_activity ->> 'maxHeartRateBpm')::smallint,
                (v_activity ->> 'cadenceSpm')::numeric,
                (v_activity ->> 'elevationGainM')::numeric,
                (v_activity ->> 'avgPowerWatts')::numeric,
                (v_activity ->> 'externalLoadKg')::numeric,
                coalesce(v_activity -> 'details', '{}'::jsonb),
                v_activity ->> 'notes',
                coalesce(v_activity ->> 'originalText', '')
            )
            returning id into v_activity_id;

            for v_set in select * from jsonb_array_elements(coalesce(v_activity -> 'strengthSets', '[]'::jsonb))
            loop
                insert into public.strength_sets (
                    user_id, activity_id, set_index, exercise_id, exercise_raw_text,
                    apparatus, exercise_confidence, set_type, reps, load_value,
                    load_unit, load_scope, load_kg, side, rir, rpe, tempo,
                    rest_seconds, hold_seconds, completed, notes, original_text
                )
                values (
                    p_user_id, v_activity_id,
                    (v_set ->> 'setIndex')::smallint,
                    (select e.id from public.exercises e
                      where e.slug = (v_set -> 'exercise' ->> 'slug')),
                    coalesce(nullif(btrim(v_set -> 'exercise' ->> 'rawText'), ''), 'unknown'),
                    v_set -> 'exercise' ->> 'apparatus',
                    coalesce((v_set -> 'exercise' ->> 'confidence')::numeric, 0),
                    (v_set ->> 'setType')::public.strength_set_type,
                    (v_set ->> 'reps')::smallint,
                    (v_set ->> 'loadValue')::numeric,
                    (v_set ->> 'loadUnit')::public.load_unit,
                    (v_set ->> 'loadScope')::public.load_scope,
                    (v_set ->> 'loadKg')::numeric,
                    (v_set ->> 'side')::public.body_side,
                    (v_set ->> 'rir')::smallint,
                    (v_set ->> 'rpe')::numeric,
                    v_set ->> 'tempo',
                    (v_set ->> 'restSeconds')::integer,
                    (v_set ->> 'holdSeconds')::numeric,
                    coalesce((v_set ->> 'completed')::boolean, true),
                    v_set ->> 'notes',
                    coalesce(v_set ->> 'originalText', '')
                );
            end loop;

            for v_interval in select * from jsonb_array_elements(coalesce(v_activity -> 'cardioIntervals', '[]'::jsonb))
            loop
                insert into public.cardio_intervals (
                    user_id, activity_id, interval_index, interval_type,
                    duration_seconds, rest_seconds, distance_km, pace_seconds_per_km,
                    split_seconds_per_500m, speed_value, speed_unit, heart_rate_bpm,
                    power_watts, cadence_spm, calories, notes, original_text
                )
                values (
                    p_user_id, v_activity_id,
                    (v_interval ->> 'intervalIndex')::smallint,
                    (v_interval ->> 'intervalType')::public.cardio_interval_type,
                    (v_interval ->> 'durationSeconds')::numeric,
                    (v_interval ->> 'restSeconds')::numeric,
                    (v_interval ->> 'distanceKm')::numeric,
                    (v_interval ->> 'paceSecondsPerKm')::numeric,
                    (v_interval ->> 'splitSecondsPer500m')::numeric,
                    (v_interval ->> 'speedValue')::numeric,
                    v_interval ->> 'speedUnit',
                    (v_interval ->> 'heartRateBpm')::smallint,
                    (v_interval ->> 'powerWatts')::numeric,
                    (v_interval ->> 'cadenceSpm')::numeric,
                    (v_interval ->> 'calories')::numeric,
                    v_interval ->> 'notes',
                    coalesce(v_interval ->> 'originalText', '')
                );
            end loop;

            v_circuit := v_activity -> 'circuit';
            if v_circuit is not null and jsonb_typeof(v_circuit) = 'object' then
                insert into public.circuit_results (
                    user_id, activity_id, format, name, rounds_prescribed,
                    rounds_completed, partial_round_reps, time_cap_seconds,
                    completion_seconds, score, work_seconds, rest_seconds,
                    as_prescribed, details, notes, original_text
                )
                values (
                    p_user_id, v_activity_id,
                    (v_circuit ->> 'format')::public.circuit_format,
                    v_circuit ->> 'name',
                    (v_circuit ->> 'roundsPrescribed')::smallint,
                    (v_circuit ->> 'roundsCompleted')::numeric,
                    (v_circuit ->> 'partialRoundReps')::smallint,
                    (v_circuit ->> 'timeCapSeconds')::numeric,
                    (v_circuit ->> 'completionSeconds')::numeric,
                    v_circuit ->> 'score',
                    (v_circuit ->> 'workSeconds')::numeric,
                    (v_circuit ->> 'restSeconds')::numeric,
                    (v_circuit ->> 'asPrescribed')::boolean,
                    coalesce(v_circuit -> 'details', '{}'::jsonb),
                    v_circuit ->> 'notes',
                    coalesce(v_circuit ->> 'originalText', '')
                )
                returning id into v_circuit_id;

                for v_movement in select * from jsonb_array_elements(coalesce(v_circuit -> 'movements', '[]'::jsonb))
                loop
                    insert into public.circuit_movements (
                        user_id, circuit_result_id, movement_order, exercise_id,
                        exercise_raw_text, apparatus, exercise_confidence, target_reps,
                        target_calories, target_distance_km, target_seconds, load_value,
                        load_unit, load_scope, load_kg, notes, original_text
                    )
                    values (
                        p_user_id, v_circuit_id,
                        (v_movement ->> 'movementOrder')::smallint,
                        (select e.id from public.exercises e
                          where e.slug = (v_movement -> 'exercise' ->> 'slug')),
                        coalesce(nullif(btrim(v_movement -> 'exercise' ->> 'rawText'), ''), 'unknown'),
                        v_movement -> 'exercise' ->> 'apparatus',
                        coalesce((v_movement -> 'exercise' ->> 'confidence')::numeric, 0),
                        (v_movement ->> 'targetReps')::smallint,
                        (v_movement ->> 'targetCalories')::numeric,
                        (v_movement ->> 'targetDistanceKm')::numeric,
                        (v_movement ->> 'targetSeconds')::numeric,
                        (v_movement ->> 'loadValue')::numeric,
                        (v_movement ->> 'loadUnit')::public.load_unit,
                        (v_movement ->> 'loadScope')::public.load_scope,
                        (v_movement ->> 'loadKg')::numeric,
                        v_movement ->> 'notes',
                        coalesce(v_movement ->> 'originalText', '')
                    );
                end loop;
            end if;

            v_benchmark := v_activity -> 'benchmark';
            if v_benchmark is not null and jsonb_typeof(v_benchmark) = 'object' then
                insert into public.benchmark_results (
                    user_id, activity_id, definition_id, definition_slug, variant_label,
                    scoring, total_seconds, rounds_completed, score, vest_kg,
                    as_prescribed, partition_strategy, notes, original_text
                )
                values (
                    p_user_id, v_activity_id,
                    (select d.id from public.benchmark_definitions d
                      where d.slug = (v_benchmark ->> 'definitionSlug')),
                    v_benchmark ->> 'definitionSlug',
                    v_benchmark ->> 'variantLabel',
                    (v_benchmark ->> 'scoring')::public.benchmark_scoring,
                    (v_benchmark ->> 'totalSeconds')::numeric,
                    (v_benchmark ->> 'roundsCompleted')::numeric,
                    v_benchmark ->> 'score',
                    (v_benchmark ->> 'vestKg')::numeric,
                    (v_benchmark ->> 'asPrescribed')::boolean,
                    v_benchmark ->> 'partitionStrategy',
                    v_benchmark ->> 'notes',
                    coalesce(v_benchmark ->> 'originalText', '')
                )
                returning id into v_benchmark_id;

                for v_split in select * from jsonb_array_elements(coalesce(v_benchmark -> 'splits', '[]'::jsonb))
                loop
                    insert into public.benchmark_splits (
                        user_id, benchmark_result_id, split_order, label, reps,
                        distance_km, elapsed_seconds, split_seconds, is_cumulative,
                        reference_frame, pace_seconds_per_km, heart_rate_bpm,
                        cadence_spm, notes, original_text
                    )
                    values (
                        p_user_id, v_benchmark_id,
                        (v_split ->> 'splitOrder')::smallint,
                        v_split ->> 'label',
                        (v_split ->> 'reps')::integer,
                        (v_split ->> 'distanceKm')::numeric,
                        (v_split ->> 'elapsedSeconds')::numeric,
                        (v_split ->> 'splitSeconds')::numeric,
                        coalesce((v_split ->> 'isCumulative')::boolean, false),
                        coalesce(v_split ->> 'referenceFrame', 'segment'),
                        (v_split ->> 'paceSecondsPerKm')::numeric,
                        (v_split ->> 'heartRateBpm')::smallint,
                        (v_split ->> 'cadenceSpm')::numeric,
                        v_split ->> 'notes',
                        coalesce(v_split ->> 'originalText', '')
                    );
                end loop;
            end if;
        end loop;

        session_id := v_session_id;
        client_request_key := v_key;
        return next;
    end loop;
end;
$$;

comment on function public.apply_import_entry(uuid, uuid, jsonb, jsonb) is
    'Applies one workbook cell atomically: upserts its import_entries row, replaces any sessions previously imported from that cell, and inserts the full activity/set/interval/circuit/benchmark tree. Rerunning is idempotent.';
