package matcher

import "github.com/prensa-abierta/ingestor-engine/pkg/storage"

// BackfillAll recorre TODO lo que ya esté en el store (típicamente noticias
// ingeridas antes de que este matcher existiera) y enlaza las que resulten
// "la misma noticia" entre sí. Pensado para correr UNA sola vez en segundo
// plano al arrancar el servidor — de ahí en adelante, cada ingestión nueva se
// enlaza sola contra el resto (ver el helper ingestRawNews en cmd/server).
//
// Como se recorre cada item del pool como candidato contra el pool entero, el
// enlace queda bidireccional sin pasos extra: si A matchea con B, se agrega al
// procesar A (A→B) y también al procesar B (B→A) más adelante en el mismo loop.
func BackfillAll(store *storage.Store, cfg Config, logoBySourceID map[string]string) {
	pool := store.GetAllRawNewsDeduped()
	for _, item := range pool {
		for _, m := range FindMatches(item, pool, cfg, logoBySourceID) {
			store.AppendRelatedSource(item.ID, m.Related, cfg.MaxMatches)
		}
	}
}
