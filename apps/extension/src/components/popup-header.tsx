import logo from "@/assets/logo.svg";

import { APP_NAME } from "./links";

export function PopupHeader({ baseUrl }: { baseUrl?: string }) {
  const title = baseUrl?.trim() || APP_NAME;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <img src={logo} alt="" width={30} height={30} className="shrink-0" />
      <div className="min-w-0 leading-tight">
        <div className="text-[15px] font-semibold tracking-[-0.02em] truncate" title={title}>
          {title}
        </div>
      </div>
    </div>
  );
}
