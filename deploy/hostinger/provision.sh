#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: provision.sh <public-key-file> <repository-root>" >&2
  exit 64
fi

public_key_file=$1
repository_root=$2
key_line=$(cat "$public_key_file")
if [[ "$key_line" != ssh-ed25519\ * ]]; then
  echo "expected an ed25519 public key" >&2
  exit 64
fi

if ! id s29deploy >/dev/null 2>&1; then
  useradd --create-home --home-dir /home/s29deploy --shell /bin/sh s29deploy
fi
usermod --shell /bin/sh s29deploy
password_hash=$(openssl rand -hex 32 | openssl passwd -6 -stdin)
printf 's29deploy:%s\n' "$password_hash" | chpasswd --encrypted
unset password_hash

install -d -o root -g root -m 0755 /srv/s29-bots /srv/s29-bots/shared /srv/s29-bots/releases
install -d -o s29deploy -g s29deploy -m 0700 /home/s29deploy/.ssh
printf 'restrict,command="/usr/local/sbin/s29_bots_ssh_command" %s\n' "$key_line" > /home/s29deploy/.ssh/authorized_keys
chown s29deploy:s29deploy /home/s29deploy/.ssh/authorized_keys
chmod 0600 /home/s29deploy/.ssh/authorized_keys

install -o root -g root -m 0755 "$repository_root/deploy/hostinger/ssh_command.sh" /usr/local/sbin/s29_bots_ssh_command
install -o root -g root -m 0755 "$repository_root/deploy/hostinger/deploy_s29_bots.sh" /usr/local/sbin/deploy_s29_bots
printf 's29deploy ALL=(root) NOPASSWD: /usr/local/sbin/deploy_s29_bots\n' > /etc/sudoers.d/s29-bots-deploy
chmod 0440 /etc/sudoers.d/s29-bots-deploy
visudo -cf /etc/sudoers.d/s29-bots-deploy >/dev/null

cat > /etc/ssh/sshd_config.d/80-s29-bots-deploy.conf <<'EOF'
Match User s29deploy
  AuthenticationMethods publickey
  PasswordAuthentication no
  KbdInteractiveAuthentication no
Match all
AllowUsers root lua-aegis-ext-import s29deploy
EOF
chmod 0644 /etc/ssh/sshd_config.d/80-s29-bots-deploy.conf
sshd -t
effective_ssh_config=$(sshd -T -C user=s29deploy,host=localhost,addr=127.0.0.1)
if ! grep -Fqx 'authenticationmethods publickey' <<< "$effective_ssh_config"; then
  echo "deployment account is not restricted to public-key authentication" >&2
  exit 1
fi
if ! grep -Fqx 'passwordauthentication no' <<< "$effective_ssh_config"; then
  echo "deployment account still allows password authentication" >&2
  exit 1
fi
for allowed_user in root lua-aegis-ext-import s29deploy; do
  if ! grep -Fqx "allowusers $allowed_user" <<< "$effective_ssh_config"; then
    echo "SSH allowlist is missing $allowed_user" >&2
    exit 1
  fi
done
systemctl reload ssh.service

echo "provisioned restricted s29-bots deployment access"
