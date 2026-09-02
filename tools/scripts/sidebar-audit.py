"""
Sidebar audit: simulate the live hasPermission() chain against (a) the
actual backend permissions just fetched, and (b) the portal menu config
from menu-config.ts. Print which items render and which don't, with and
without the portal-backend permission mapping.
"""
import json, os, re, sys

PERMS_FILES = {
    'admin':       '/tmp/perm-truth/admin.json',
    'super_admin': '/tmp/perm-truth/super_admin.json',
    'doctor':      '/tmp/perm-truth/doctor.json',
    'pharmacy':    '/tmp/perm-truth/pharmacy.json',
    'emergency':   '/tmp/perm-truth/emergency.json',
}

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PT = open(os.path.join(ROOT, 'apps/web-portal/src/lib/rbac/permissions.ts')).read()
PERM_MAP = {}
for m in re.finditer(r"(\w+):\s*'([^']+)'\s*as\s*Permission", PT):
    PERM_MAP[m.group(1)] = m.group(2)

MP = open(os.path.join(ROOT, 'apps/web-portal/src/lib/rbac/permission-mapping.ts')).read()
MAPPING = {}
for m in re.finditer(r"'([^']+)':\s*\[([^\]]*)\]", MP):
    key = m.group(1)
    inner = m.group(2)
    vals = re.findall(r"'([^']+)'", inner)
    MAPPING[key] = vals

MC = open(os.path.join(ROOT, 'apps/web-portal/src/lib/rbac/menu-config.ts')).read()

def extract_config(name, source):
    pat = re.compile(rf"export const {name}:\s*MenuGroup\[\]\s*=\s*\[")
    m = pat.search(source)
    if not m: return None
    start = m.end()
    depth = 1
    i = start
    while i < len(source) and depth > 0:
        c = source[i]
        if c == '[': depth += 1
        elif c == ']': depth -= 1
        i += 1
    return source[start:i-1]

MENU_CFG_ADMIN  = extract_config('MENU_CONFIG', MC)
MENU_CFG_DOCTOR = extract_config('DOCTOR_MENU_CONFIG', MC)
MENU_CFG_PHARM  = extract_config('PHARMACY_MENU_CONFIG', MC)

def parse_groups(blob):
    if not blob: return []
    groups = []
    pos = 0
    while pos < len(blob):
        m = re.search(r'\{\s*id:', blob[pos:])
        if not m: break
        g_start = pos + m.start()
        depth = 1
        i = g_start + 1
        while i < len(blob) and depth > 0:
            c = blob[i]
            if c == '{': depth += 1
            elif c == '}': depth -= 1
            i += 1
        group_text = blob[g_start:i]
        gid = re.search(r"id:\s*'([^']+)'", group_text).group(1)
        glabel = re.search(r"label:\s*'([^']*)'", group_text)
        glabel = glabel.group(1) if glabel else ''
        items_match = re.search(r"items:\s*\[", group_text)
        items_text = group_text[items_match.end():]
        d = 1; j = 0
        while j < len(items_text) and d > 0:
            c = items_text[j]
            if c == '[': d += 1
            elif c == ']': d -= 1
            j += 1
        items_str = items_text[:j-1]
        items = parse_items(items_str)
        groups.append({'id':gid,'label':glabel,'items':items})
        pos = i
    return groups

def parse_items(blob):
    items = []
    pos = 0
    while pos < len(blob):
        m = re.search(r'\{\s*id:', blob[pos:])
        if not m: break
        i_start = pos + m.start()
        d = 1; i = i_start + 1
        while i < len(blob) and d > 0:
            c = blob[i]
            if c == '{': d += 1
            elif c == '}': d -= 1
            i += 1
        obj = blob[i_start:i]
        item = {
            'id': re.search(r"id:\s*'([^']+)'", obj).group(1),
            'label': re.search(r"label:\s*'([^']+)'", obj).group(1),
        }
        rp = re.search(r"requiredPermission:\s*PERMISSIONS\.(\w+)", obj)
        item['requiredPermission'] = PERM_MAP[rp.group(1)] if rp else None
        ch = re.search(r"children:\s*\[", obj)
        if ch:
            ctext = obj[ch.end():]
            d = 1; j = 0
            while j < len(ctext) and d > 0:
                c = ctext[j]
                if c == '[': d += 1
                elif c == ']': d -= 1
                j += 1
            item['children'] = parse_items(ctext[:j-1])
        else:
            item['children'] = []
        items.append(item)
        pos = i
    return items

admin_menu  = parse_groups(MENU_CFG_ADMIN)
doctor_menu = parse_groups(MENU_CFG_DOCTOR)
pharm_menu  = parse_groups(MENU_CFG_PHARM)

def menu_for_role(role):
    if role == 'doctor': return doctor_menu
    if role == 'pharmacy': return pharm_menu
    return admin_menu

def matches(perm_user, perm_req):
    if perm_user == '*': return True
    if perm_user == perm_req: return True
    parts_u = perm_user.split(':')
    parts_r = perm_req.split(':')
    if len(parts_u) >= 2 and len(parts_r) >= 2:
        if parts_u[0] == parts_r[0] and parts_u[1] == parts_r[1] and len(parts_u) >= 3 and len(parts_r) == 2:
            return True
        if parts_u[0] == parts_r[0] and parts_u[1] == '*': return True
        if parts_u[0] == '*' and parts_u[1] == parts_r[1]: return True
    return False

def has_permission(user_perms, required, use_mapping=True):
    if not required: return True
    for up in user_perms:
        if matches(up, required): return True
    if use_mapping:
        for backend in MAPPING.get(required, []):
            if backend in user_perms: return True
    return False

def load_backend_perms(role):
    j = json.load(open(PERMS_FILES[role]))
    active = j['session']['active_role']
    for m in j['memberships']:
        if m['role'] == active:
            return set(m.get('permissions', []))
    return set()

def count_for_role(role, use_mapping):
    user_perms = load_backend_perms(role)
    groups = menu_for_role(role)
    total = 0
    shown = 0
    for g in groups:
        for it in g['items']:
            total += 1
            if has_permission(user_perms, it['requiredPermission'], use_mapping): shown += 1
            for c in it['children']:
                total += 1
                if has_permission(user_perms, c['requiredPermission'], use_mapping): shown += 1
    return shown, total, user_perms

print(f'\n{"="*90}')
print(f'{"ROLE":<14}{"items (no mapping)":<24}{"items (with mapping)":<24}{"perms held":<14}')
print('='*90)
for r in ['admin','super_admin','doctor','pharmacy','emergency']:
    no_map, total, perms = count_for_role(r, use_mapping=False)
    with_map, _, _     = count_for_role(r, use_mapping=True)
    print(f'{r:<14}{no_map}/{total:<22}{with_map}/{total:<22}{len(perms):<14}')
print()

# Per-role: which items would be visible with mapping, and which are STILL blocked
# despite the mapping (these are the bugs to fix)
def walk_blocked(role):
    user_perms = load_backend_perms(role)
    groups = menu_for_role(role)
    blocked = []
    for g in groups:
        for it in g['items']:
            if not has_permission(user_perms, it['requiredPermission'], True):
                blocked.append((it['id'], it['label'], it['requiredPermission']))
            for c in it['children']:
                if not has_permission(user_perms, c['requiredPermission'], True):
                    blocked.append((c['id'], c['label'], c['requiredPermission']))
    return blocked

for r in ['admin','super_admin','doctor','pharmacy','emergency']:
    blocked = walk_blocked(r)
    if not blocked:
        print(f'  {r}: full sidebar visible (no remaining blocks)')
    else:
        print(f'  {r}: still blocked ({len(blocked)}):')
        for id_, label, req in blocked:
            print(f'    - {id_:<32} (req={req})')
