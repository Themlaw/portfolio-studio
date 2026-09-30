"use client";

/** Client Better Auth (navigateur) : connexion, déconnexion. */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ basePath: "/api/auth" });
