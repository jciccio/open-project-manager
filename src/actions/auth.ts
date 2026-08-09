"use server";

import { db } from "@/lib/db";
import { createSession, destroySession, getSession } from "@/lib/auth";
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

    if (!user) {
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
