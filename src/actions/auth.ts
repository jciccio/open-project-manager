"use server";

import { db } from "@/lib/db";
import { createSession, destroySession, getSession, signApiToken } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

export async function registerUser(formData: {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
}) {
  try {
    const { name, email, password, confirmPassword } = formData;

    if (!name.trim() || !email.trim() || !password) {
      return { success: false, error: "All fields are required." };
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return { success: false, error: "Passwords do not match." };
    }

    if (password.length < 6) {
      return { success: false, error: "Password must be at least 6 characters long." };
    }

    const existingUser = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return { success: false, error: "An account with this email already exists." };
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await db.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
      },
    });

    await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    revalidatePath("/");
    return { success: true, data: { userId: user.id, email: user.email, name: user.name } };
  } catch (error) {
    console.error("Registration error:", error);
    return { success: false, error: "Failed to register user." };
  }
}

export async function loginUser(formData: { email: string; password: string }) {
  try {
    const { email, password } = formData;

    if (!email.trim() || !password) {
      return { success: false, error: "Email and password are required." };
    }

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user || !user.passwordHash) {
      return { success: false, error: "Invalid email or password." };
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return { success: false, error: "Invalid email or password." };
    }

    await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    revalidatePath("/");
    return { success: true, data: { userId: user.id, email: user.email, name: user.name } };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, error: "Failed to log in." };
  }
}

export async function logoutUser() {
  await destroySession();
  revalidatePath("/");
  return { success: true };
}

export async function getCurrentUser() {
  return await getSession();
}

export async function updateUserProfile(data: {
  name?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}) {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      return { success: false, error: "User not found." };
    }

    const updateData: { name?: string; email?: string; passwordHash?: string } = {};

    if (data.name !== undefined) {
      const trimmedName = data.name.trim();
      if (!trimmedName) {
        return { success: false, error: "Name cannot be empty." };
      }
      updateData.name = trimmedName;
    }

    if (data.email !== undefined) {
      const trimmedEmail = data.email.toLowerCase().trim();
      if (!trimmedEmail) {
        return { success: false, error: "Email cannot be empty." };
      }
      if (trimmedEmail !== user.email) {
        const existing = await db.user.findUnique({
          where: { email: trimmedEmail },
        });
        if (existing) {
          return { success: false, error: "An account with this email already exists." };
        }
        updateData.email = trimmedEmail;
      }
    }

    if (data.newPassword) {
      // A user with no passwordHash yet (OIDC-only) has nothing to verify
      // against — the active session already proves their identity.
      if (user.passwordHash) {
        if (!data.currentPassword) {
          return { success: false, error: "Current password is required to change password." };
        }
        const isValid = await bcrypt.compare(data.currentPassword, user.passwordHash);
        if (!isValid) {
          return { success: false, error: "Current password is incorrect." };
        }
      }
      if (data.newPassword.length < 6) {
        return { success: false, error: "New password must be at least 6 characters long." };
      }
      updateData.passwordHash = await bcrypt.hash(data.newPassword, 10);
    }

    const updatedUser = await db.user.update({
      where: { id: session.userId },
      data: updateData,
    });

    await createSession({
      userId: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
    });

    revalidatePath("/");
    return {
      success: true,
      data: {
        userId: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
      },
    };
  } catch (error) {
    console.error("Update profile error:", error);
    return { success: false, error: "Failed to update profile." };
  }
}

export async function listApiTokens() {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const tokens = await db.apiToken.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });

    return { success: true, tokens };
  } catch (error) {
    console.error("List API tokens error:", error);
    return { success: false, error: "Failed to list API tokens." };
  }
}

export async function createApiToken(name: string) {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return { success: false, error: "Token name is required." };
    }

    const record = await db.apiToken.create({
      data: { userId: session.userId, name: trimmedName },
    });

    const secret = await signApiToken(session, record.id);

    return {
      success: true,
      token: {
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        secret,
      },
    };
  } catch (error) {
    console.error("Create API token error:", error);
    return { success: false, error: "Failed to create API token." };
  }
}

export async function revokeApiToken(id: string) {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const record = await db.apiToken.findUnique({ where: { id } });
    if (!record || record.userId !== session.userId) {
      return { success: false, error: "Token not found." };
    }

    await db.apiToken.delete({ where: { id } });

    return { success: true };
  } catch (error) {
    console.error("Revoke API token error:", error);
    return { success: false, error: "Failed to revoke API token." };
  }
}


