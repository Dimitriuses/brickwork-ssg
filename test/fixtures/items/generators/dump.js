// Test generator: consume the engine-resolved ctx.collection.items and emit one page per item.
module.exports = {
  generate(ctx) {
    return ctx.collection.items.map(({ id, item }) => ({
      slug: id,
      title: item.data ? item.data.name : '(no data)',
      vars: {
        ID: id,
        NAME: item.data ? item.data.name : '',
        IMG0: item.images[0] || '',
        NIMG: String(item.images.length)
      }
    }));
  }
};
