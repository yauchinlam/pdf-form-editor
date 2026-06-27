import { useId, useState } from "react";

export function SignatureInput({ onSignatureChange, placeholder = "Type your name to sign" }) {
  const [name, setName] = useState("");
  const inputId = useId();

  function handleChange(event) {
    const value = event.target.value;
    setName(value);
    onSignatureChange?.(value);
  }

  return (
    <section className="mb-6 w-full max-w-md rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
      <div className="relative mt-6">
        <input
          id={inputId}
          type="text"
          value={name}
          onChange={handleChange}
          placeholder={placeholder}
          className="w-full border-b-2 border-gray-300 bg-transparent pb-1 pt-2 text-3xl italic text-blue-800 transition-colors placeholder:text-xl placeholder:not-italic placeholder:text-gray-300 focus:border-blue-600 focus:outline-none"
          style={{ fontFamily: "'Caveat', cursive, sans-serif" }}
        />
        <label
          htmlFor={inputId}
          className="absolute -top-4 left-0 text-xs font-semibold uppercase tracking-wider text-gray-400"
        >
          Employee Signature
        </label>
      </div>
      <p className="mt-2 text-xs italic text-gray-400">
        This is a temporary script-styled font preview representation of your signature.
      </p>
    </section>
  );
}
