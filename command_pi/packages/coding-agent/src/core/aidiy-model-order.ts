// AiDiy: use the registered Diag catalog order without changing upstream Pi's fallback.
type ModelRow = { provider: string; id: string };
type Catalog = Record<string, Record<string, string>>;
let readCatalog: (() => Catalog) | undefined;

export function setAidiyModelOrder(read: () => Catalog): void {
	readCatalog = read;
}

export function sortAidiyModels<T extends ModelRow>(models: readonly T[]): T[] {
	const catalog = readCatalog?.() ?? {};
	const providers = new Map(Object.keys(catalog).map((provider, index) => [provider, index]));
	const positions = new Map(Object.entries(catalog).map(([provider, entries]) => [
		provider,
		new Map(Object.keys(entries).map((id, index) => [id, index])),
	]));
	const fallback = Number.MAX_SAFE_INTEGER;
	return [...models].sort((a, b) => {
		const section = (providers.get(a.provider) ?? fallback) - (providers.get(b.provider) ?? fallback);
		if (section) return section;
		if (a.provider === b.provider) {
			const index = positions.get(a.provider);
			const position = (index?.get(a.id) ?? fallback) - (index?.get(b.id) ?? fallback);
			if (position) return position;
		}
		return a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
	});
}
