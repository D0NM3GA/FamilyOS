/**
 * Phase 29: SYNTHETIC order emails for tests: made-up people, addresses and numbers laid out
 * the way the real retailers' mails are (tables, a hidden preheader, Amazon's right-to-left
 * mark around the order number, Apple's hidden mobile copy, Publix's relay sender).
 */
export const AMAZON = `
<div style="display:none">Ordered 1 item: Floor Care&#847; &zwnj; &shy;</div>
<div class="body"><table><tbody><tr><td><strong>Your Orders</strong></td></tr></tbody></table>
<h2 class="rio-header"><div>Pat, thanks for your order!</div></h2>
<div>Ordered</div><div>Packed</div><div>Out for delivery</div><div>Delivered</div>
<div>Arriving today by 5:10 PM</div>
<div>1 Floor Care item</div>
<div>Pat - SPRINGFIELD, ZZ</div>
<div>Order # &#x202B;111-1234567-7654321</div>
<a href="https://example.test/order-details?orderID=111-1234567-7654321">View or edit order</a>
<table><tbody><tr><td style="width:50%">Grand Total:</td><td style="font-weight:bold">$15.73</td></tr></tbody></table>
<div>©2026 Example. 410 Terry Avenue N.</div></div>`;

export const APPLE = `
<html><head><style>@media (max-width:480px){.aapl-desktop-div{display:none}.aapl-mobile-div{display:block!important}}</style></head><body>
<table><tbody><tr><td><div class="aapl-desktop-div"><table><tbody>
<tr><td>Receipt</td></tr>
<tr><td>APPLE ACCOUNT<br />kid@example.test </td><td>BILLED TO<br />Visa .... 0000<br />Pat Example<br />1 Main St<br />Springfield, ZZ 00000<br />USA </td></tr>
<tr><td>DATE<br />Aug 25, 2026</td></tr>
<tr><td>ORDER ID<br /><a href="https://example.test">MX9EXAMPLE</a></td><td>DOCUMENT NO.<br />700000000001</td></tr>
</tbody></table>
<table><tbody><tr class="section-header"><td>App Store</td></tr>
<tr><td class="artwork-cell"> </td><td class="item-cell">Block Game <br />SEASON PASS<br />In-App Purchase <br />Kid's iPad<br /><a></a><a href="https://example.test">Report a Problem</a> </td><td class="price-cell"><table><tbody><tr><td>$8.99</td></tr></tbody></table></td></tr>
<tr><td class="artwork-cell"> </td><td class="item-cell">Block Game <br />PASS PLUS UPGRADE<br />In-App Purchase <br />Kid's iPad<br /><a href="https://example.test">Report a Problem</a> </td><td class="price-cell"><table><tbody><tr><td>$4.99</td></tr></tbody></table></td></tr>
</tbody></table>
<table><tbody><tr><td>Subtotal</td><td>$13.98</td></tr><tr><td>Tax</td><td>$0.98</td></tr><tr><td>TOTAL</td><td></td><td>$14.96 </td></tr></tbody></table>
</div><div class="aapl-mobile-div" style="display:none"><table><tbody>
<tr><td>ORDER ID<br />MX9EXAMPLE </td></tr><tr><td>Block Game <br />SEASON PASS</td></tr><tr><td>$8.99</td></tr>
<tr><td>TOTAL</td><td>$14.96 </td></tr></tbody></table></div></td></tr></tbody></table></body></html>`;

export const PUBLIX = `
<div>This email was sent to made-up.alias42@mailer.me (Instacart) from NoReply.Publix@publix.com<br />Click here to deactivate this alias</div>
<h1>Order confirmation</h1><h1>We&rsquo;ve received your order.</h1>
<p>Hey Pat, we&rsquo;re working on your order. Thanks for shopping with Publix. <br /><strong>Order number:</strong> 1234-P0001 </p>
<h2>Pickup time</h2><h3>October 25, 2025 at 1:45 PM</h3>
<h2>Pickup location</h2><h3>Publix at Example Square</h3>
<h2>Pick up your items and pay at the register.</h2>
<h1>Your order</h1>
<h2>Pick up from the Deli department</h2>
<p>Example&reg; Chicken Sub Whole Hot</p><p>Qty: 1</p></td><td><p>$10.99</p>
<p>Example&reg; Italian Whole Sub</p><p>Qty: 2</p></td><td><p>$19.98</p>
<h1>Order summary</h1>
<table><tbody><tr><td><h1>Estimated Total</h1></td><td><h1>$30.97</h1></td></tr></tbody></table>`;

