update private.stockflow_gateway_config
set secret_sha256 = '58b287cec2daa4abb51e748c4249260ceee5b986e3a1bb871a795246a0fb7f87', rotated_at = now()
where name = 'orders';
