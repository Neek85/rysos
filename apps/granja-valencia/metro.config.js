const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Config manual de monorepo (https://docs.expo.dev/guides/monorepos/,
// seccion "legacy"/pre-SDK 52) -- necesaria a pesar de estar en SDK 57:
// el auto-config de SDK 52+ solo se activa si Metro detecta un monorepo
// real (workspaces de npm/yarn/pnpm con un lockfile compartido en la
// raiz). apps/granja-valencia tiene su propio package-lock.json
// independiente, sin ningun campo "workspaces" que lo enlace con la
// raiz de este repo -- no es ese tipo de monorepo, asi que Metro nunca
// ve mas alla de este directorio sin esto. Error real reproducido por
// Neyser en dispositivo: "UnableToResolveError... Unable to resolve
// module ../../../../lib/validations/pecuario" -- tsc SI resuelve ese
// import (Node/TS resuelven hacia arriba por defecto), pero Metro no,
// hasta este archivo.
//
// NOTA sobre la doc oficial: el bloque de codigo de esa pagina usa
// `projectRoot` en nodeModulesPaths sin declararlo en ningun lado del
// snippet -- gap real de la doc, no un error de tipeo nuestro. Se
// reemplaza por `__dirname` (linea de arriba, `getDefaultConfig(__dirname)`,
// ya usa `__dirname` con ese mismo sentido: la raiz de ESTE proyecto).
const monorepoRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot];
// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
