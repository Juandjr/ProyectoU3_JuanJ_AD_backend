const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

transporter.verify((error) => {
  if (error) {
    console.error('Error al conectar con el servidor de correo:', error);
  } else {
    console.log('Servidor de correo listo para enviar mensajes');
  }
});

async function sendVerificationEmail({ name, email, code, expirationMinutes }) {
  const mailOptions = {
    from: `"Aplicaciones Distribuidas" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `${code} es su código de activación`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ccc; padding: 20px; border-radius: 10px;">
        <h2 style="color: #4CAF50; text-align: center;">Activación de Cuenta</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Gracias por registrarte. Para completar tu registro, por favor ingresa el siguiente código de verificación:</p>
        <div style="background-color: #f2f2f2; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; border-radius: 5px; margin: 20px 0;">
          ${code}
        </div>
        <p>Este código expira en <strong>${expirationMinutes} minutos</strong>.</p>
        <p>Si no solicitaste este registro, por favor ignora este correo.</p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #777; text-align: center;">Aplicaciones Distribuidas</p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}

async function sendPasswordRecoveryEmail({ name, email, token, baseUrl }) {
  const frontendBaseUrl = String(
    baseUrl ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.BASE_URL ||
    'http://localhost:4200'
  ).replace(/\/+$/, '');
  const recoveryUrl = `${frontendBaseUrl}/reset-password?email=${encodeURIComponent(email)}&token=${token}`;

  const mailOptions = {
    from: `"Aplicaciones Distribuidas" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Recuperación de Contraseña',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ccc; padding: 20px; border-radius: 10px;">
        <h2 style="color: #2196F3; text-align: center;">Recuperación de Contraseña</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Hemos recibido una solicitud para restablecer tu contraseña. Haz clic en el siguiente botón para cambiarla:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${recoveryUrl}" style="background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            Restablecer Contraseña
          </a>
        </div>
        <p>O copia y pega el siguiente enlace en tu navegador:</p>
        <p style="word-break: break-all;"><a href="${recoveryUrl}">${recoveryUrl}</a></p>
        <p>Este enlace expira en 30 minutos.</p>
        <p>Si no solicitaste recuperar tu contraseña, puedes ignorar este correo de forma segura.</p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #777; text-align: center;">Aplicaciones Distribuidas</p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}

module.exports = {
  sendVerificationEmail,
  sendPasswordRecoveryEmail,
};
