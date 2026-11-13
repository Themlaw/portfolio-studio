# Security Policy

## Supported versions

Security fixes are released for the latest minor version only. To stay protected, keep your instance on the latest release.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Instead, use GitHub's private vulnerability reporting (*Security* tab → *Report a vulnerability*).

Include the affected version (`vX.Y.Z` tag or commit), the steps to reproduce and the impact you observed. You will get an answer within a week, and a fix will be released as soon as it is ready. We are happy to credit you in the release notes if you wish.

## Scope

- the application (public routes, `/admin`, media upload API, theme and Photoshop kit import);
- the Docker image and the provided `docker-compose.yml`;
- the GitHub Actions workflows of this repository.

Out of scope: instances misconfigured by their operator (weak secret, missing `PUBLIC_BASE_URL`, etc.).

## Configuration best practices

- Use a random `BETTER_AUTH_SECRET` of at least 32 characters, unique to your instance.
- Set `PUBLIC_BASE_URL` to your HTTPS address in production.
- Set `AUTH_TRUSTED_PROXY_HOPS` to the number of reverse proxies in front of the app, then check in *Admin → Settings → Diagnostics* that the detected IP address is yours.
- Restrict administration to known accounts or to an OpenID Connect group.
- Keep the image up to date and enable Dependabot alerts on your fork.

This repository contains no secrets, production data or real artwork: fixtures and demo content are synthetic. If you ever find a secret or personal data in it, please report it as a vulnerability.
