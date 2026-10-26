#!/usr/bin/env python3
"""Configura GitHub para CanchaYa: rama develop, protección de ramas, etiquetas,
milestones e issues del backlog. Requiere: git, GitHub CLI (gh) autenticado y
ejecutarse DENTRO del repositorio ya creado y con remoto 'origin'.

Uso:
  python scripts/setup_github.py --dry-run     # solo muestra qué haría
  python scripts/setup_github.py               # ejecuta todo
  python scripts/setup_github.py --only issues # labels | milestones | issues | branches
Es idempotente: puedes repetirlo sin duplicar issues.
"""
import argparse, csv, json, subprocess, sys

EPICS = {
    "E0": "Fase 0: Descubrimiento",
    "E1": "Fase 1: Fundaciones",
    "E2": "Fase 2: Núcleo de reservas y panel",
    "E3": "Fase 3: Bot de WhatsApp (MVP)",
    "E4": "Fase 4: Piloto",
    "E5": "Fase 5: Pagos y retención",
    "E6": "Fase 6: Operación completa",
    "E7": "Fase 7: Replicación",
}
LABELS = {
    "type:story": "0E8A16", "type:bug": "D73A4A", "type:task": "5319E7", "type:spike": "FBCA04",
    "rol:backend": "1D76DB", "rol:frontend": "0075CA", "rol:ux": "F9D0C4", "rol:qa": "BFD4F2",
    "rol:devops": "C5DEF5", "rol:negocio": "D4C5F9",
    "P0": "B60205", "P1": "D93F0B", "P2": "FBCA04", "P3": "C2E0C6",
    "blocked": "000000", "needs-info": "E4E669",
}
for e in EPICS:
    LABELS[f"epic:{e}"] = "BFDADC"

args = None

def run(cmd, input_text=None, check=True):
    if args.dry_run:
        print("  [dry-run]", " ".join(cmd))
        return ""
    r = subprocess.run(cmd, input=input_text, capture_output=True, text=True)
    if check and r.returncode != 0:
        print("  ERROR:", r.stderr.strip())
        return None
    return r.stdout

def repo():
    r = subprocess.run(["gh", "repo", "view", "--json", "nameWithOwner"], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("No pude leer el repositorio. ¿Ejecutas dentro del repo y 'gh auth login' está hecho?")
    return json.loads(r.stdout)["nameWithOwner"]

def do_branches(name):
    print("== Ramas ==")
    branches = subprocess.run(["git", "branch", "-a"], capture_output=True, text=True).stdout
    if "develop" not in branches:
        run(["git", "branch", "develop", "main"])
    run(["git", "push", "-u", "origin", "develop"], check=False)
    body = json.dumps({
        "required_status_checks": None,  # actívalo luego desde Settings cuando CI ya haya corrido
        "enforce_admins": False,          # te deja una salida de emergencia siendo único dev
        "required_pull_request_reviews": {"required_approving_review_count": 0},
        "restrictions": None,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "required_conversation_resolution": True,
    })
    for b in ("main", "develop"):
        out = run(["gh", "api", "-X", "PUT", f"repos/{name}/branches/{b}/protection",
                   "--input", "-", "-H", "Accept: application/vnd.github+json"], input_text=body)
        if out is None:
            print(f"  Aviso: no se pudo proteger '{b}'. En repos privados con plan gratuito GitHub no lo permite;"
                  " usa un repo público o configura la protección manualmente (ver GUIA_INICIO.md).")
        else:
            print(f"  Protegida: {b}")
    run(["gh", "repo", "edit", "--default-branch", "develop", "--delete-branch-on-merge",
         "--enable-squash-merge", "--enable-merge-commit"], check=False)

def do_labels():
    print("== Etiquetas ==")
    for n, c in LABELS.items():
        run(["gh", "label", "create", n, "--color", c, "--force"])
    print(f"  {len(LABELS)} etiquetas")

def do_milestones(name):
    print("== Milestones ==")
    existing = set()
    if not args.dry_run:
        out = run(["gh", "api", f"repos/{name}/milestones?state=all&per_page=100"]) or "[]"
        existing = {m["title"] for m in json.loads(out)}
    for t in EPICS.values():
        if t in existing:
            continue
        run(["gh", "api", "-X", "POST", f"repos/{name}/milestones", "-f", f"title={t}"])
    print(f"  {len(EPICS)} milestones")

def do_issues():
    print("== Issues ==")
    existing = set()
    if not args.dry_run:
        out = run(["gh", "issue", "list", "--state", "all", "--limit", "1000", "--json", "title"]) or "[]"
        existing = {i["title"] for i in json.loads(out)}
    created = 0
    with open("backlog/backlog.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            title = f'{row["id"]}: {row["title"]}'
            if title in existing:
                continue
            body = (f'**Épica:** {row["epic"]} · **Puntos:** {row["points"]} · **Rol:** {row["role"]}\n\n'
                    f'## Criterios de aceptación\n- [ ] {row["acceptance"]}\n\n'
                    f'## Definition of Done\nVer docs/plan.md (sección 7) y AGENTS.md.')
            labels = f'type:{row["type"]},rol:{row["role"]},epic:{row["epic"]}'
            run(["gh", "issue", "create", "--title", title, "--body", body,
                 "--label", labels, "--milestone", EPICS[row["epic"]]])
            created += 1
    print(f"  {created} issues creados")

def main():
    global args
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--only", choices=["branches", "labels", "milestones", "issues"])
    args = p.parse_args()
    name = "OWNER/REPO" if args.dry_run else repo()
    print("Repositorio:", name)
    steps = {"branches": lambda: do_branches(name), "labels": do_labels,
             "milestones": lambda: do_milestones(name), "issues": do_issues}
    for k, fn in steps.items():
        if args.only in (None, k):
            fn()
    print("Listo.")

if __name__ == "__main__":
    main()
