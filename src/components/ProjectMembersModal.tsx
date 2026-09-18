"use client";

import { useState, useEffect } from "react";
import { X, Users, UserPlus, Shield, Globe, Lock, Trash2 } from "lucide-react";
import {
  getProjectMembers,
  addProjectMember,
  updateMemberRole,
  removeProjectMember,
} from "@/actions/members";
import { updateProject } from "@/actions/projects";
import { ProjectRole } from "@/lib/permissions";
import { useRouter } from "next/navigation";

interface Props {
  project: {
    id: string;
    name: string;
    userId: string;
    visibility?: string;
    currentUserRole?: string | null;
  };
  onClose: () => void;
  onMembersChange?: () => void;
}

export default function ProjectMembersModal({ project, onClose, onMembersChange }: Props) {
  const [members, setMembers] = useState<any[]>([]);
  const [userRole, setUserRole] = useState<string | null>(project.currentUserRole || null);
  const [visibility, setVisibility] = useState<string>(project.visibility || "PRIVATE");
  const [email, setEmail] = useState("");
  const [roleToAssign, setRoleToAssign] = useState<ProjectRole>("MEMBER");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const router = useRouter();

  const isOwner = userRole === "OWNER" || project.currentUserRole === "OWNER";
  const isAdmin = isOwner || userRole === "ADMIN" || project.currentUserRole === "ADMIN";

  useEffect(() => {
    loadMembers();
  }, [project.id]);

  async function loadMembers() {
    setLoading(true);
    setError("");
    try {
      const res = await getProjectMembers(project.id);
      if (res.success && res.data) {
        setMembers(res.data);
        if (res.currentUserRole) {
          setUserRole(res.currentUserRole);
        }
      } else {
        setError(res.error || "Failed to load project members");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }

  async function handleVisibilityChange(newVisibility: string) {
    if (!isOwner) return;
    setError("");
    setSuccessMsg("");
    try {
      const res = await updateProject(project.id, { visibility: newVisibility });
      if (res.success) {
        setVisibility(newVisibility);
        setSuccessMsg(`Project visibility set to ${newVisibility.toLowerCase()}`);
        router.refresh();
      } else {
        setError(res.error || "Failed to update project visibility");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update visibility");
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await addProjectMember(project.id, email.trim(), roleToAssign);
      if (res.success && res.data) {
        setEmail("");
        setSuccessMsg(`Added ${res.data.user.name || res.data.user.email} as ${res.data.role}`);
        await loadMembers();
        onMembersChange?.();
        router.refresh();
      } else {
        setError(res.error || "Failed to add member");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to add member");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(targetUserId: string, newRole: ProjectRole) {
    setError("");
    setSuccessMsg("");
    try {
      const res = await updateMemberRole(project.id, targetUserId, newRole);
      if (res.success) {
        setSuccessMsg("Member role updated");
        await loadMembers();
        onMembersChange?.();
        router.refresh();
      } else {
        setError(res.error || "Failed to update member role");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update role");
    }
  }

  async function handleRemoveMember(targetUserId: string) {
    setError("");
    setSuccessMsg("");
    try {
      const res = await removeProjectMember(project.id, targetUserId);
      if (res.success) {
        setSuccessMsg("Member removed from project");
        await loadMembers();
        onMembersChange?.();
        router.refresh();
      } else {
        setError(res.error || "Failed to remove member");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to remove member");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Members & Privacy
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {project.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mt-4 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-500 font-medium">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mt-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-500 font-medium">
            {successMsg}
          </div>
        )}

        <div className="mt-4 space-y-6 overflow-y-auto flex-1 pr-1">
          {/* Visibility Section */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-800/30">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-indigo-500" />
              Project Privacy & Visibility
            </h4>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                type="button"
                disabled={!isOwner}
                onClick={() => handleVisibilityChange("PRIVATE")}
                className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                  visibility === "PRIVATE"
                    ? "border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300"
                } ${!isOwner ? "cursor-not-allowed opacity-75" : ""}`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs mb-1">
                  <Lock className="h-3.5 w-3.5" />
                  <span>Private</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Only explicitly added members can access this project.
                </p>
              </button>

              <button
                type="button"
                disabled={!isOwner}
                onClick={() => handleVisibilityChange("INTERNAL")}
                className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                  visibility === "INTERNAL"
                    ? "border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300"
                } ${!isOwner ? "cursor-not-allowed opacity-75" : ""}`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs mb-1">
                  <Globe className="h-3.5 w-3.5" />
                  <span>Internal</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  All authenticated users on this instance can view this project.
                </p>
              </button>
            </div>
            {!isOwner && (
              <p className="text-[10px] text-slate-400 mt-2">
                * Only project owners can modify visibility settings.
              </p>
            )}
          </div>

          {/* Add Member Form (Admin/Owner only) */}
          {isAdmin && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5 text-indigo-500" />
                Invite Collaborator
              </h4>
              <form onSubmit={handleAddMember} className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="collaborator@example.com"
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                />
                <select
                  value={roleToAssign}
                  onChange={(e) => setRoleToAssign(e.target.value as ProjectRole)}
                  className="rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="MEMBER">Member (Edit)</option>
                  <option value="VIEWER">Viewer (Read-only)</option>
                  <option value="ADMIN">Admin (Full project edit)</option>
                  {isOwner && <option value="OWNER">Owner (Full control)</option>}
                </select>
                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors shrink-0"
                >
                  {submitting ? "Adding..." : "Add"}
                </button>
              </form>
            </div>
          )}

          {/* Members List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Project Members ({members.length})
              </h4>
            </div>

            {loading ? (
              <div className="text-center py-6 text-xs text-slate-400">
                Loading members...
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {members.map((member) => {
                  const isCreator = project.userId === member.userId;
                  const canManageThis =
                    isAdmin && !isCreator && (isOwner || member.role !== "OWNER");

                  const initials = member.user.name
                    ? member.user.name
                        .split(" ")
                        .map((n: string) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)
                    : member.user.email.slice(0, 2).toUpperCase();

                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white shadow-xs">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {member.user.name || "Member"}{" "}
                            {isCreator && (
                              <span className="text-[10px] font-normal text-indigo-500 dark:text-indigo-400 ml-1">
                                (Creator)
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {member.user.email}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {canManageThis ? (
                          <select
                            value={member.role}
                            onChange={(e) =>
                              handleRoleChange(member.userId, e.target.value as ProjectRole)
                            }
                            className="rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                          >
                            <option value="VIEWER">Viewer</option>
                            <option value="MEMBER">Member</option>
                            <option value="ADMIN">Admin</option>
                            {isOwner && <option value="OWNER">Owner</option>}
                          </select>
                        ) : (
                          <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {member.role}
                          </span>
                        )}

                        {canManageThis && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.userId)}
                            className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                            title="Remove member"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800 mt-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
