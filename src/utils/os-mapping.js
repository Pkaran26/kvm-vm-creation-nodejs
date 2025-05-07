// Mapping of OS names to their download URLs and cloud-init support
const osDownloadMap = {
  ubuntu22: {
    url: "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img",
    filename: "jammy-server-cloudimg-amd64.img",
    formalName: "ubuntu-22.04",
    variant: "ubuntujammy",
    packageManager: "apt",
    installCommands: {
      mysql: ["sudo apt update", "sudo apt install -y mysql-server"],
      mongodb: ["sudo apt update", "sudo apt install -y mongodb"],
      nginx: ["sudo apt update", "sudo apt install -y nginx"],
    },
  },
  ubuntu24: {
    url: "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img",
    filename: "noble-server-cloudimg-amd64.img",
    formalName: "ubuntu-24.04",
    variant: "ubuntunoble",
    packageManager: "apt",
    installCommands: {
      mysql: ["sudo apt update", "sudo apt install -y mysql-server"],
      mongodb: ["sudo apt update", "sudo apt install -y mongodb"],
      nginx: ["sudo apt update", "sudo apt install -y nginx"],
    },
  },
  centos8: {
    url: "https://cloud.centos.org/centos/8/x86_64/images/CentOS-8-GenericCloud-8.1.1911-20200113.3.x86_64.qcow2",
    filename: "CentOS-8-GenericCloud-8.1.1911-20200113.3.x86_64.qcow2",
    formalName: "Centos-8",
    variant: "centos8"
  }
};

module.exports = osDownloadMap;
