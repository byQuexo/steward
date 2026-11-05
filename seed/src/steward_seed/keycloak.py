"""A Keycloak realm generated from the seed users, so roles and attributes match the profile."""

from __future__ import annotations

import json
from typing import Any

ATTRS = [("org_unit", False), ("tenants", True), ("teams", True), ("doc_scope", True)]


def _attr_mapper(name: str, multivalued: bool) -> dict[str, Any]:
    return {
        "name": name,
        "protocol": "openid-connect",
        "protocolMapper": "oidc-usermodel-attribute-mapper",
        "consentRequired": False,
        "config": {
            "user.attribute": name,
            "claim.name": name,
            "jsonType.label": "String",
            "multivalued": "true" if multivalued else "false",
            "access.token.claim": "true",
            "id.token.claim": "false",
            "userinfo.token.claim": "false",
            "introspection.token.claim": "true",
        },
    }


def realm(cfg: dict[str, Any], users: list[dict[str, Any]], roles: list[str]) -> dict[str, Any]:
    kc = cfg.get("keycloak", {})
    audience = kc.get("gateway_audience", "http://localhost:8088/mcp")
    app_url = kc.get("app_url", "http://localhost:8000")
    bot = kc.get("bot_client", "acme-bot")
    profile_attrs = [
        {"name": n, "displayName": n, "permissions": {"view": ["admin"], "edit": ["admin"]}, "multivalued": mv} for n, mv in ATTRS
    ]
    base_attrs = [
        {"name": "username", "displayName": "${username}", "validations": {"length": {"min": 3, "max": 255}}, "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "email", "displayName": "${email}", "validations": {"email": {}, "length": {"max": 255}}, "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "firstName", "displayName": "${firstName}", "validations": {"length": {"max": 255}}, "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "lastName", "displayName": "${lastName}", "validations": {"length": {"max": 255}}, "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
    ]
    kc_users = []
    for u in users:
        first, _, last = u["name"].partition(" ")
        attrs = {}
        for name, mv in ATTRS:
            v = u["attrs"].get(name)
            if v is None:
                continue
            attrs[name] = list(v) if mv else [v]
        kc_users.append(
            {
                "username": u["id"],
                "enabled": True,
                "emailVerified": True,
                "email": u["email"],
                "firstName": first,
                "lastName": last or first,
                "credentials": [{"type": "password", "value": u["password"], "temporary": False}],
                "realmRoles": u["roles"],
                "attributes": attrs,
            }
        )
    kc_users.append(
        {
            "username": "service-account-steward-console",
            "enabled": True,
            "serviceAccountClientId": "steward-console",
            "clientRoles": {"realm-management": ["view-users", "manage-users", "query-users", "view-realm"]},
        }
    )
    mappers = [
        {
            "name": "gateway-audience",
            "protocol": "openid-connect",
            "protocolMapper": "oidc-audience-mapper",
            "consentRequired": False,
            "config": {"included.custom.audience": audience, "access.token.claim": "true", "id.token.claim": "false", "introspection.token.claim": "true"},
        }
    ] + [_attr_mapper(n, mv) for n, mv in ATTRS]
    return {
        "realm": cfg["realm"],
        "enabled": True,
        "accessTokenLifespan": 300,
        "ssoSessionIdleTimeout": 3600,
        "sslRequired": "none",
        "roles": {"realm": [{"name": r} for r in roles]},
        "users": kc_users,
        "clients": [
            {
                # The orchestrator agent is the OAuth client users log in to (code + PKCE).
                "clientId": bot,
                "name": "Steward assistant",
                "enabled": True,
                "publicClient": False,
                "secret": "dev-bot-secret",
                "clientAuthenticatorType": "client-secret",
                "standardFlowEnabled": True,
                "directAccessGrantsEnabled": True,
                "serviceAccountsEnabled": False,
                "redirectUris": [f"{app_url}/auth/callback"],
                "webOrigins": [app_url],
                "attributes": {"pkce.code.challenge.method": "S256", "post.logout.redirect.uris": f"{app_url}/*"},
                "protocol": "openid-connect",
                "fullScopeAllowed": True,
                "protocolMappers": mappers,
            },
            {
                # The console reads and changes users and roles (Keycloak admin API).
                "clientId": "steward-console",
                "enabled": True,
                "publicClient": False,
                "secret": "dev-console-secret",
                "clientAuthenticatorType": "client-secret",
                "standardFlowEnabled": False,
                "serviceAccountsEnabled": True,
                "protocol": "openid-connect",
            },
            {
                # The gateway introspects user tokens (instant revocation).
                "clientId": "warden-gateway",
                "enabled": True,
                "publicClient": False,
                "secret": "dev-gateway-secret",
                "clientAuthenticatorType": "client-secret",
                "standardFlowEnabled": False,
                "serviceAccountsEnabled": True,
                "protocol": "openid-connect",
            },
        ],
        "components": {
            "org.keycloak.userprofile.UserProfileProvider": [
                {
                    "providerId": "declarative-user-profile",
                    "subComponents": {},
                    "config": {"kc.user.profile.config": [json.dumps({"attributes": base_attrs + profile_attrs, "groups": [], "unmanagedAttributePolicy": "ENABLED"})]},
                }
            ]
        },
    }
