import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  /** Allow free text entries not present in options. */
  allowCustom?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Combobox-style input: lets the user type to filter, then only commits values
 * that exist in the dropdown unless allowCustom is explicitly enabled.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  allowCustom = false,
  disabled,
  className,
}: Props) {
  const { t } = useI18n();
  const selectedOption = options.find((o) => o.value === value);
  const selectedLabel = selectedOption?.label ?? value ?? "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query]);

  const selectOption = (nextValue: string, nextLabel: string) => {
    setQuery(nextLabel);
    onChange(nextValue);
    setOpen(false);
  };

  const commitTypedValue = () => {
    const typed = query.trim();
    const exact = options.find((o) => o.label.toLowerCase() === typed.toLowerCase());
    if (exact) selectOption(exact.value, exact.label);
    else if (allowCustom) onChange(typed);
    else setQuery(selectedLabel);
  };

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(commitTypedValue, 100)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const first = filteredOptions[0];
            const exact = options.find((o) => o.label.toLowerCase() === query.trim().toLowerCase());
            if (exact) selectOption(exact.value, exact.label);
            else if (first) selectOption(first.value, first.label);
            else commitTypedValue();
          }
          if (e.key === "Escape") {
            setQuery(selectedLabel);
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn("rounded-none border-2 border-foreground", className)}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      {open && !disabled && options.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto border-2 border-foreground bg-popover text-popover-foreground shadow-md">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(o.value, o.label)}
              >
                {o.label}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t("No match")}</div>
          )}
        </div>
      )}
    </div>
  );
}
