#!/usr/bin/env python3
"""Create a static, small HTTPS-friendly snapshot of the public IEK schedule API.

Uses only the Python standard library. Intended for GitHub Actions and local refreshes.
"""

import concurrent.futures
import datetime as dt
import json
import os
import pathlib
import sys
import tempfile
import time
import urllib.error
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "schedule.json"
API = "http://scheduleapi.iek.irk.ru/API/"
WORKERS = 4  # Avoid flooding the college server.


def get_json(endpoint):
    url = API + endpoint
    last_error = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                url,
                headers={"Accept": "application/json", "User-Agent": "IEK-PWA-Snapshot/1.0"},
                method="GET",
            )
            with urllib.request.urlopen(request, timeout=22) as response:
                if response.status != 200:
                    raise ValueError(f"Unexpected HTTP {response.status}")
                return json.load(response)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"{endpoint}: {last_error}")


def text(value):
    return str(value or "").strip()


def normalized_lesson(row):
    pair = row.get("pair") if isinstance(row.get("pair"), dict) else {}
    teacher = row.get("teachers") if isinstance(row.get("teachers"), dict) else {}
    change = row.get("edit") if isinstance(row.get("edit"), dict) else {}
    changed_pair = change.get("editPair") if isinstance(change.get("editPair"), dict) else {}
    changed_teacher = change.get("editTeacher") if isinstance(change.get("editTeacher"), dict) else {}
    edit = None
    if change:
        edit = {
            "room": text(change.get("editNumberRoomId")),
            "subject": text(changed_pair.get("name")),
            "teacher": text(changed_teacher.get("name")),
            "createdAt": text(change.get("createDate")),
        }
    return {
        "id": row.get("id"),
        "day": int(row.get("dayOfWeek") or 0),
        "pair": int(row.get("numberPair") or 0),
        "typeWeek": row.get("typeWeek"),
        "groupId": row.get("groupId"),
        "subject": text(pair.get("name")),
        "teacher": text(teacher.get("name")),
        "room": text(row.get("numberRoom")),
        "edit": edit,
    }


def normalize_array(raw, endpoint):
    if not isinstance(raw, list):
        raise TypeError(f"{endpoint}: expected JSON array")
    return raw


def fetch_schedule(kind_and_id):
    kind, identifier = kind_and_id
    endpoint = f"{'GroupScheduleByID' if kind == 'group' else 'TeacherScheduleByID'}?id={identifier}"
    return kind, identifier, [normalized_lesson(row) for row in normalize_array(get_json(endpoint), endpoint) if isinstance(row, dict)]


def main():
    old = {}
    if OUTPUT.exists():
        try:
            old = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            old = {}

    print("Fetching source dictionaries and week settings...", flush=True)
    raw_groups = normalize_array(get_json("Groups"), "Groups")
    raw_teachers = normalize_array(get_json("GetTeachersDistinct"), "GetTeachersDistinct")
    settings = normalize_array(get_json("GetSettings"), "GetSettings")
    groups = [
        {"id": int(g["id"]), "course": g.get("numberCourse"),
         "shortName": text((g.get("nameNavigation") or {}).get("nameGroup")),
         "visible": bool(g.get("isVisible", True))}
        for g in raw_groups if isinstance(g, dict) and g.get("id") is not None
    ]
    teachers = [{"id": i, "name": text(name)} for i, name in enumerate(raw_teachers) if text(name)]
    requests = [("group", group["id"]) for group in groups]
    requests += [("teacher", item["id"]) for item in teachers]
    group_results = {}
    teacher_results = {}
    errors = []

    print(f"Loading {len(groups)} group and {len(teachers)} teacher schedules with {WORKERS} workers...", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_schedule, request): request for request in requests}
        for position, future in enumerate(concurrent.futures.as_completed(futures), 1):
            kind, identifier = futures[future]
            try:
                _, _, rows = future.result()
                (group_results if kind == "group" else teacher_results)[str(identifier)] = rows
            except Exception as error:
                errors.append(f"{kind} {identifier}: {error}")
                print(f"WARN: {errors[-1]}", file=sys.stderr, flush=True)
            if position % 25 == 0 or position == len(requests):
                print(f"Completed {position}/{len(requests)}", flush=True)

    # Preserve a previous successful snapshot for an endpoint that temporarily fails.
    old_groups = {}
    for item in old.get("groupLessons", []):
        old_groups.setdefault(str(item.get("groupId")), []).append(item)
    for group in groups:
        identifier = str(group["id"])
        if identifier not in group_results:
            group_results[identifier] = old_groups.get(identifier, [])
    for item in teachers:
        identifier = str(item["id"])
        if identifier not in teacher_results:
            teacher_results[identifier] = old.get("teacherSchedules", {}).get(identifier, [])

    # Without full group data, free-room searches must be explicitly marked incomplete.
    group_errors = sum(1 for error in errors if error.startswith("group "))
    teacher_errors = len(errors) - group_errors
    all_group_lessons = [lesson for group in groups for lesson in group_results[str(group["id"])]]
    all_group_lessons.sort(key=lambda item: (item["day"], item["pair"], item["groupId"] or 0, item["id"] or 0))
    for schedule in teacher_results.values():
        schedule.sort(key=lambda item: (item["day"], item["pair"], item["groupId"] or 0))

    output = {
        "schema": 1,
        "initialized": True,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "parityWeek": text((settings[0] if settings and isinstance(settings[0], dict) else {}).get("parityWeek")),
        "groups": groups,
        "teachers": teachers,
        "groupLessons": all_group_lessons,
        "teacherSchedules": teacher_results,
        "meta": {
            "groupErrors": group_errors,
            "teacherErrors": teacher_errors,
            "warnings": errors[:30],
        },
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", dir=OUTPUT.parent, delete=False) as file:
        json.dump(output, file, ensure_ascii=False, separators=(",", ":"))
        temp_name = file.name
    os.replace(temp_name, OUTPUT)
    print(f"Wrote {OUTPUT}: {len(all_group_lessons)} group lessons, {len(teacher_results)} teacher schedules, {len(errors)} errors", flush=True)
    # Partial data is usable (with warnings) once a first full or partial snapshot exists.
    if not all_group_lessons:
        print("No group lessons available; refusing a successful sync.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
