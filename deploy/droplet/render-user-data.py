#!/usr/bin/env python3
"""Renders cloud-init.sh into DigitalOcean user_data by filling __VAR__ placeholders from env files.

Usage: python3 render-user-data.py secrets.env [more.env ...] > user_data.sh
Unset optional values become empty strings; required ones abort. Never commit the output.
"""
import re
import sys
from pathlib import Path

REQUIRED = {
    'BRANCH', 'REPO_URL', 'SITE_HOST', 'PLATFORM_ADMIN_EMAILS', 'ACME_EMAIL', 'STATUS_PASSWORD',
    'POSTGRES_SUPERUSER_PASSWORD', 'SPA_OWNER_PASSWORD', 'SPA_PLATFORM_PASSWORD', 'SPA_APP_PASSWORD',
    'BETTER_AUTH_SECRET',
}

env: dict[str, str] = {}
for f in sys.argv[1:]:
    for line in Path(f).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k] = v

template = (Path(__file__).parent / 'cloud-init.sh').read_text()
missing = sorted(k for k in REQUIRED if not env.get(k))
if missing:
    sys.exit(f'missing required values: {", ".join(missing)}')
for k, v in env.items():
    if re.search(r'[\'"`$\\\n]', v):
        sys.exit(f'{k} contains characters that are unsafe in the shell template')

out = re.sub(r'__([A-Z0-9_]+)__', lambda m: env.get(m.group(1), ''), template)
sys.stdout.write(out)
