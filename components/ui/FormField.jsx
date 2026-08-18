// Helper de campo de formulario — versión JSX de FormHelpers.tsx del
// repo origen (backend-inspecciones), usando utilidades Tailwind planas
// en vez de las clases custom (`input`, `label`, `card`) de ese repo,
// que no existen en tailwind.config.js de rysos.

export function FieldError({ msg }) {
  if (!msg) return null
  return <p className="mt-1 text-xs text-red-500">{msg}</p>
}

export function FormField({ label, required, error, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
      <FieldError msg={error} />
    </div>
  )
}

export const inputClass = (hasError) =>
  `w-full rounded-lg border px-3 py-2 text-sm ${
    hasError ? 'border-red-300' : 'border-gray-200'
  } focus:outline-none focus:ring-1 focus:ring-green-700`
