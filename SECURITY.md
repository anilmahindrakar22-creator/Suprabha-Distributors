# Security policy

Do not place credentials, tokens, Tally data exports, or customer data in issues or source control. Runtime secrets belong in the hosting platform's encrypted environment settings.

## Release policy

- Critical and high dependency vulnerabilities block release.
- Authentication and authorization changes require automated tests and manual sign-in verification.
- All stock endpoints must deny unauthenticated and unapproved users.
- Production data responses must use private, no-store caching.
- Security fixes use a short-lived `security/*` branch and receive priority review.

Report a suspected vulnerability privately to the StockFlow administrators. Include the affected page, time observed, and reproduction steps without including sensitive business data.
