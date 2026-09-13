import {
  LayoutDashboard,
  Package,
  FlaskConical,
  Settings2,
  ShoppingCart,
  Factory,
  Receipt,
  FileOutput,
  Undo2,
  Boxes,
  BookOpenCheck,
  BarChart3,
  DatabaseBackup,
} from "lucide-react";

export const MODULES = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, group: "Overview", phase: "Phase 1" },
  { to: "/app/items", label: "Items Master", icon: Package, group: "Master Data", phase: "Phase 2" },
  { to: "/app/formula", label: "Formula / BOM", icon: FlaskConical, group: "Master Data", phase: "Phase 2" },
  { to: "/app/setup", label: "Setup / Masters", icon: Settings2, group: "Master Data", phase: "Phase 3" },
  { to: "/app/purchase", label: "Purchase", icon: ShoppingCart, group: "Operations", phase: "Phase 4" },
  { to: "/app/production", label: "Production", icon: Factory, group: "Operations", phase: "Phase 4" },
  { to: "/app/counter-sale", label: "Counter Sale", icon: Receipt, group: "Sales", phase: "Phase 5" },
  { to: "/app/issue-voucher", label: "Issue Voucher", icon: FileOutput, group: "Sales", phase: "Phase 5" },
  { to: "/app/returns", label: "Return", icon: Undo2, group: "Sales", phase: "Phase 5" },
  { to: "/app/stock", label: "Stock", icon: Boxes, group: "Ledgers", phase: "Phase 6" },
  { to: "/app/accounts", label: "Accounts", icon: BookOpenCheck, group: "Ledgers", phase: "Phase 6" },
  { to: "/app/reports", label: "Reports", icon: BarChart3, group: "Ledgers", phase: "Phase 7" },
  { to: "/app/backup", label: "Backup", icon: DatabaseBackup, group: "System", phase: "Phase 7" },
] as const;

export const MODULE_GROUPS = ["Overview", "Master Data", "Operations", "Sales", "Ledgers", "System"] as const;
