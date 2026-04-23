import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { useDateRange, type DatePreset } from "@/contexts/date-range-context";
import { cn } from "@/lib/utils";

interface PresetOption {
  key: DatePreset;
  label: string;
  shortLabel: string;
}

const PRESET_OPTIONS: PresetOption[] = [
  { key: "today", label: "Today", shortLabel: "Today" },
  { key: "7d", label: "Last 7 Days", shortLabel: "7D" },
  { key: "14d", label: "Last 14 Days", shortLabel: "14D" },
  { key: "30d", label: "Last 30 Days", shortLabel: "30D" },
  { key: "90d", label: "Last 90 Days", shortLabel: "90D" },
  { key: "mtd", label: "Month to Date", shortLabel: "MTD" },
  { key: "ytd", label: "Year to Date", shortLabel: "YTD" },
];

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isInRange(day: Date, from: Date | null, to: Date | null) {
  if (!from || !to) return false;
  const t = day.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function MiniCalendar({
  viewDate,
  onViewDateChange,
  selectedFrom,
  selectedTo,
  hoverDate,
  onDayClick,
  onDayHover,
  maxDate,
}: {
  viewDate: Date;
  onViewDateChange: (d: Date) => void;
  selectedFrom: Date | null;
  selectedTo: Date | null;
  hoverDate: Date | null;
  onDayClick: (d: Date) => void;
  onDayHover: (d: Date | null) => void;
  maxDate: Date;
}) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const prevMonth = () => onViewDateChange(new Date(year, month - 1, 1));
  const nextMonth = () => {
    const next = new Date(year, month + 1, 1);
    if (next <= maxDate) onViewDateChange(next);
  };

  const rangeEnd = selectedTo ?? hoverDate;

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d, 0, 0, 0, 0));

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2 px-0.5">
        <button onClick={prevMonth} className="p-1 rounded-lg hover:bg-surface-container-low transition-colors">
          <ChevronLeft className="w-3.5 h-3.5 text-on-surface-variant" />
        </button>
        <span className="text-[11px] font-semibold text-on-surface">{MONTHS[month]} {year}</span>
        <button
          onClick={nextMonth}
          disabled={new Date(year, month + 1, 1) > maxDate}
          className="p-1 rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-30"
        >
          <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0">
        {DAYS.map((d) => (
          <div key={d} className="h-6 flex items-center justify-center">
            <span className="text-[8px] font-semibold text-on-surface-variant/60 uppercase">{d}</span>
          </div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="h-7" />;
          const disabled = day > maxDate;
          const isFrom = selectedFrom && isSameDay(day, selectedFrom);
          const isTo = rangeEnd && isSameDay(day, rangeEnd);
          const inRange = selectedFrom && rangeEnd && isInRange(day, selectedFrom, rangeEnd);
          const isToday = isSameDay(day, new Date());
          return (
            <button
              key={day.getTime()}
              disabled={disabled}
              onClick={() => onDayClick(day)}
              onMouseEnter={() => onDayHover(day)}
              className={cn(
                "h-7 text-[10px] font-medium relative flex items-center justify-center transition-all",
                disabled && "opacity-30 cursor-not-allowed",
                !disabled && !isFrom && !isTo && !inRange && "hover:bg-accent-blue/8 rounded-lg",
                inRange && !isFrom && !isTo && "bg-accent-blue/8",
                (isFrom || isTo) && "bg-accent-blue text-white rounded-lg z-10",
                isFrom && rangeEnd && !isSameDay(selectedFrom!, rangeEnd) && "rounded-r-none",
                isTo && selectedFrom && !isSameDay(selectedFrom, rangeEnd!) && "rounded-l-none",
                isToday && !isFrom && !isTo && "ring-1 ring-accent-blue/30 rounded-lg",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ compact = false }: { compact?: boolean }) {
  const { dateRange, setPreset, setCustomRange } = useDateRange();
  const [open, setOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [pickFrom, setPickFrom] = useState<Date | null>(null);
  const [pickTo, setPickTo] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCalendarOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handlePreset = useCallback((key: DatePreset) => {
    setPreset(key);
    setOpen(false);
    setCalendarOpen(false);
  }, [setPreset]);

  const handleDayClick = useCallback((day: Date) => {
    if (!pickFrom || (pickFrom && pickTo)) {
      setPickFrom(day);
      setPickTo(null);
    } else {
      if (day < pickFrom) {
        setPickTo(pickFrom);
        setPickFrom(day);
      } else {
        setPickTo(day);
      }
    }
  }, [pickFrom, pickTo]);

  const handleApplyCustom = useCallback(() => {
    if (!pickFrom || !pickTo) return;
    const from = new Date(pickFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(pickTo);
    to.setHours(23, 59, 59, 999);
    setCustomRange(from, to);
    setOpen(false);
    setCalendarOpen(false);
  }, [pickFrom, pickTo, setCustomRange]);

  const openCalendar = useCallback(() => {
    setCalendarOpen(true);
    if (dateRange.preset === "custom") {
      setPickFrom(dateRange.from);
      setPickTo(dateRange.to);
      setViewDate(new Date(dateRange.from));
    } else {
      setPickFrom(null);
      setPickTo(null);
      setViewDate(new Date());
    }
  }, [dateRange]);

  const fromStr = pickFrom
    ? pickFrom.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "Start";
  const toStr = pickTo
    ? pickTo.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "End";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-xl border transition-all",
          compact
            ? "px-2.5 py-1.5 text-[10px]"
            : "px-3 py-2 text-[11px]",
          open
            ? "border-accent-blue/40 bg-accent-blue/5 text-accent-blue shadow-sm"
            : "border-outline-variant/20 bg-white hover:border-outline-variant/40 text-on-surface",
        )}
      >
        <Calendar className={cn(compact ? "w-3 h-3" : "w-3.5 h-3.5", "shrink-0")} />
        <span className="font-semibold whitespace-nowrap">{dateRange.label}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform shrink-0", open && "rotate-180")} />
      </button>

      {open && (
        <div
          className={cn(
            "absolute top-full mt-2 z-50 bg-white border border-outline-variant/20 rounded-2xl shadow-xl overflow-hidden",
            calendarOpen ? "left-1/2 -translate-x-1/2 w-[340px]" : "left-0 w-[240px]",
          )}
        >
          {!calendarOpen ? (
            <>
              <div className="px-4 py-2.5 border-b border-outline-variant/10">
                <span className="text-[9px] font-bold text-on-surface-variant/60 uppercase tracking-[0.15em]">Date Range</span>
              </div>

              <div className="py-1">
                {PRESET_OPTIONS.map((opt) => {
                  const isActive = dateRange.preset === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => handlePreset(opt.key)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all",
                        isActive
                          ? "bg-accent-blue/6 text-accent-blue"
                          : "text-on-surface hover:bg-surface-container-low",
                      )}
                    >
                      <span className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                        isActive ? "border-accent-blue bg-accent-blue" : "border-outline-variant/30",
                      )}>
                        {isActive && <Check className="w-2.5 h-2.5 text-white" />}
                      </span>
                      <span className="text-[11px] font-medium flex-1">{opt.label}</span>
                      <span className={cn(
                        "text-[9px] font-semibold px-1.5 py-0.5 rounded-md",
                        isActive ? "bg-accent-blue/10 text-accent-blue" : "bg-surface-container-low text-on-surface-variant/60",
                      )}>{opt.shortLabel}</span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-outline-variant/10">
                <button
                  onClick={openCalendar}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-all",
                    dateRange.preset === "custom"
                      ? "bg-accent-blue/6 text-accent-blue"
                      : "text-on-surface hover:bg-surface-container-low",
                  )}
                >
                  <span className={cn(
                    "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                    dateRange.preset === "custom" ? "border-accent-blue bg-accent-blue" : "border-outline-variant/30",
                  )}>
                    {dateRange.preset === "custom" && <Check className="w-2.5 h-2.5 text-white" />}
                  </span>
                  <span className="text-[11px] font-medium flex-1">Custom Range</span>
                  <Calendar className="w-3.5 h-3.5 text-on-surface-variant/40" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-outline-variant/10">
                <button
                  onClick={() => setCalendarOpen(false)}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <ChevronLeft className="w-3 h-3" />
                  Back
                </button>
                <span className="text-[9px] font-bold text-on-surface-variant/60 uppercase tracking-[0.15em]">Custom Range</span>
                <button
                  onClick={() => { setOpen(false); setCalendarOpen(false); }}
                  className="p-0.5 rounded-md hover:bg-surface-container-low transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-on-surface-variant" />
                </button>
              </div>

              <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center gap-2">
                <div className={cn(
                  "flex-1 px-3 py-2 rounded-xl border text-center text-[11px] font-medium transition-all",
                  pickFrom ? "border-accent-blue/30 bg-accent-blue/5 text-accent-blue" : "border-outline-variant/20 text-on-surface-variant",
                )}>
                  {fromStr}
                </div>
                <span className="text-[10px] text-on-surface-variant font-medium">–</span>
                <div className={cn(
                  "flex-1 px-3 py-2 rounded-xl border text-center text-[11px] font-medium transition-all",
                  pickTo ? "border-accent-blue/30 bg-accent-blue/5 text-accent-blue" : "border-outline-variant/20 text-on-surface-variant",
                )}>
                  {toStr}
                </div>
              </div>

              <div className="px-4 py-3">
                <MiniCalendar
                  viewDate={viewDate}
                  onViewDateChange={setViewDate}
                  selectedFrom={pickFrom}
                  selectedTo={pickTo}
                  hoverDate={hoverDate}
                  onDayClick={handleDayClick}
                  onDayHover={setHoverDate}
                  maxDate={today}
                />
              </div>

              <div className="px-4 pb-3">
                <button
                  onClick={handleApplyCustom}
                  disabled={!pickFrom || !pickTo}
                  className="w-full py-2.5 rounded-xl text-[11px] font-bold bg-accent-blue text-white disabled:opacity-30 hover:bg-accent-blue/90 transition-all"
                >
                  Apply Range
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
