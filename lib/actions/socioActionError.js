// Clase de error del módulo de Socios/Parcelas — en un archivo separado
// (no 'use server') porque un módulo Server Actions solo puede exportar
// funciones async (Next.js lo exige); una clase exportada ahí rompe el
// build.

export class SocioActionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SocioActionError'
  }
}
