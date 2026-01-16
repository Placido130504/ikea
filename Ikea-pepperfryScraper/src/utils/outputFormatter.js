let counter = 1;

function formatProduct(product) {
  return {
    "Product ID": `A-${String(counter++).padStart(4, '0')}`,
    "Product Name": product.title,
    "Product URL": product.url,
    "Rating": product.rating || 0,
    "Image URL": product.imageUrl,
    "Dimensions": product.dimensions || "N/A",
    "Price": Number(product.price)
  };
}

module.exports = { formatProduct };
